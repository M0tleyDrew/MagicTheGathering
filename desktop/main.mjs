import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const APP_USER_MODEL_ID = "com.saltybananaslug.mtg-deck-editor";
const LOOPBACK_HOST = "127.0.0.1";
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

let localServer = null;
let localOrigin = null;
let settingsPath = null;

function safeClientPath(clientRoot, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const relative = decoded.replace(/^\/+/, "");
  const resolved = path.resolve(clientRoot, relative);
  return resolved === clientRoot || resolved.startsWith(`${clientRoot}${path.sep}`) ? resolved : null;
}

async function localAssetResponse(clientRoot, request) {
  const url = new URL(request.url);
  const target = safeClientPath(clientRoot, url.pathname);
  if (!target) return null;

  try {
    const stats = await fs.stat(target);
    if (!stats.isFile()) return null;
    const headers = new Headers({
      "Content-Length": String(stats.size),
      "Content-Type": mimeTypes.get(path.extname(target).toLowerCase()) ?? "application/octet-stream",
      "Cache-Control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    if (request.method === "HEAD") return new Response(null, { status: 200, headers });
    return new Response(await fs.readFile(target), { status: 200, headers });
  } catch {
    return null;
  }
}

async function requestBody(incoming) {
  if (incoming.method === "GET" || incoming.method === "HEAD") return undefined;
  const chunks = [];
  let size = 0;
  for await (const chunk of incoming) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function sendResponse(outgoing, response, headOnly = false) {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, name) => outgoing.setHeader(name, value));
  if (headOnly || !response.body) {
    outgoing.end();
    return;
  }
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}

async function startLocalAppServer() {
  const appRoot = app.getAppPath();
  const clientRoot = path.join(appRoot, "dist", "client");
  const serverEntry = path.join(appRoot, "dist", "server", "index.js");
  const worker = (await import(pathToFileURL(serverEntry).href)).default;
  if (!worker || typeof worker.fetch !== "function") throw new Error("The packaged editor server is missing its fetch handler.");

  const executionContext = {
    passThroughOnException() {},
    waitUntil(promise) { Promise.resolve(promise).catch(() => {}); },
  };

  localServer = http.createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url ?? "/", localOrigin ?? `http://${LOOPBACK_HOST}`);
      const request = new Request(url, {
        method: incoming.method,
        headers: incoming.headers,
        body: await requestBody(incoming),
      });

      const directAsset = await localAssetResponse(clientRoot, request);
      if (directAsset) {
        await sendResponse(outgoing, directAsset, incoming.method === "HEAD");
        return;
      }

      const env = {
        ASSETS: {
          fetch: async (assetRequest) => await localAssetResponse(clientRoot, assetRequest) ?? new Response("Not Found", { status: 404 }),
        },
      };
      const response = await worker.fetch(request, env, executionContext);
      await sendResponse(outgoing, response, incoming.method === "HEAD");
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === "REQUEST_TOO_LARGE";
      outgoing.statusCode = tooLarge ? 413 : 500;
      outgoing.setHeader("Content-Type", "text/plain; charset=utf-8");
      outgoing.end(tooLarge ? "Request too large" : "The local deck editor server hit an error.");
    }
  });

  await new Promise((resolve, reject) => {
    localServer.once("error", reject);
    localServer.listen(0, LOOPBACK_HOST, resolve);
  });
  const address = localServer.address();
  if (!address || typeof address === "string") throw new Error("The local deck editor server did not receive a port.");
  localOrigin = `http://${LOOPBACK_HOST}:${address.port}`;
  return localOrigin;
}

async function encryptSecret(value) {
  if (typeof safeStorage.encryptStringAsync === "function") return await safeStorage.encryptStringAsync(value);
  return safeStorage.encryptString(value);
}

async function decryptSecret(value) {
  if (typeof safeStorage.decryptStringAsync === "function") return await safeStorage.decryptStringAsync(value);
  return safeStorage.decryptString(value);
}

async function readSettings() {
  try {
    return JSON.parse(await fs.readFile(settingsPath, "utf8"));
  } catch {
    return {};
  }
}

async function writeSettings(settings) {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
}

async function loadOpenAiKey() {
  delete process.env.OPENAI_API_KEY;
  if (!safeStorage.isEncryptionAvailable()) return false;
  const settings = await readSettings();
  if (typeof settings.openAiApiKey !== "string" || !settings.openAiApiKey) return false;
  try {
    process.env.OPENAI_API_KEY = await decryptSecret(Buffer.from(settings.openAiApiKey, "base64"));
    return Boolean(process.env.OPENAI_API_KEY);
  } catch {
    return false;
  }
}

function registerDesktopSettings() {
  ipcMain.handle("sbs:settings:status", async () => ({
    configured: Boolean(process.env.OPENAI_API_KEY),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    storage: process.platform === "win32" ? "Windows user encryption" : "Operating-system secure storage",
    appVersion: app.getVersion(),
  }));

  ipcMain.handle("sbs:settings:save-openai-key", async (_event, rawKey) => {
    const apiKey = typeof rawKey === "string" ? rawKey.trim() : "";
    if (apiKey.length < 20) throw new Error("Enter a complete OpenAI API key.");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure operating-system storage is unavailable on this computer.");
    const settings = await readSettings();
    const encrypted = await encryptSecret(apiKey);
    await writeSettings({ ...settings, openAiApiKey: Buffer.from(encrypted).toString("base64") });
    process.env.OPENAI_API_KEY = apiKey;
    return { configured: true };
  });

  ipcMain.handle("sbs:settings:clear-openai-key", async () => {
    const settings = await readSettings();
    delete settings.openAiApiKey;
    await writeSettings(settings);
    delete process.env.OPENAI_API_KEY;
    return { configured: false };
  });
}

async function createWindow(origin) {
  const appRoot = app.getAppPath();
  const window = new BrowserWindow({
    title: "SaltyBananaSlug's MTG Deck Editor",
    width: 1480,
    height: 940,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: "#0b120d",
    autoHideMenuBar: true,
    show: false,
    icon: path.join(appRoot, "desktop", "resources", "sbs-desktop.ico"),
    webPreferences: {
      contextIsolation: true,
      devTools: !app.isPackaged,
      nodeIntegration: false,
      preload: path.join(appRoot, "desktop", "preload.cjs"),
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(`${origin}/`) || url === origin) return;
    event.preventDefault();
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
  });
  window.once("ready-to-show", () => window.show());
  await window.loadURL(origin);
  return window;
}

const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();

app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

app.whenReady().then(async () => {
  app.setAppUserModelId(APP_USER_MODEL_ID);
  settingsPath = path.join(app.getPath("userData"), "settings.json");
  registerDesktopSettings();
  await loadOpenAiKey();
  const origin = await startLocalAppServer();
  await createWindow(origin);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (localServer) localServer.close();
});

