import { packager } from "@electron/packager";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const stagingDirectory = path.join(projectRoot, ".desktop-stage");
const releaseDirectory = path.join(projectRoot, "release");
const productName = "SaltyBananaSlugs MTG Deck Editor";
const sourcePackage = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
const electronVersion = sourcePackage.devDependencies.electron.replace(/^[^0-9]*/, "");

await fs.rm(stagingDirectory, { recursive: true, force: true });
await fs.mkdir(path.join(stagingDirectory, "desktop", "resources"), { recursive: true });
await fs.mkdir(releaseDirectory, { recursive: true });

await fs.cp(path.join(projectRoot, "dist"), path.join(stagingDirectory, "dist"), { recursive: true });
await fs.copyFile(path.join(projectRoot, "desktop", "main.mjs"), path.join(stagingDirectory, "desktop", "main.mjs"));
await fs.copyFile(path.join(projectRoot, "desktop", "preload.cjs"), path.join(stagingDirectory, "desktop", "preload.cjs"));
await fs.copyFile(path.join(projectRoot, "desktop", "resources", "sbs-desktop.ico"), path.join(stagingDirectory, "desktop", "resources", "sbs-desktop.ico"));

await fs.writeFile(path.join(stagingDirectory, "package.json"), `${JSON.stringify({
  name: "saltybananaslug-mtg-deck-editor-desktop",
  productName: "SaltyBananaSlug's MTG Deck Editor",
  version: sourcePackage.version,
  private: true,
  type: "module",
  main: "desktop/main.mjs",
}, null, 2)}\n`);

const appPaths = await packager({
  dir: stagingDirectory,
  name: productName,
  executableName: productName,
  platform: "win32",
  arch: "x64",
  electronVersion,
  appVersion: sourcePackage.version,
  buildVersion: sourcePackage.version,
  out: releaseDirectory,
  overwrite: true,
  prune: false,
  asar: true,
  icon: path.join(projectRoot, "desktop", "resources", "sbs-desktop.ico"),
  win32metadata: {
    CompanyName: "SaltyBananaSlug",
    FileDescription: "Commander deck editor with Scryfall and EDHREC analysis",
    InternalName: "SaltyBananaSlugMTGDeckEditor",
    OriginalFilename: `${productName}.exe`,
    ProductName: "SaltyBananaSlug's MTG Deck Editor",
    "requested-execution-level": "asInvoker",
  },
});

if (appPaths.length !== 1) throw new Error(`Expected one Windows package, received ${appPaths.length}.`);
const appDirectory = appPaths[0];
await fs.copyFile(path.join(projectRoot, "desktop", "WINDOWS-README.txt"), path.join(appDirectory, "README.txt"));

const zipName = "SaltyBananaSlugs-MTG-Deck-Editor-Windows-x64.zip";
const zipPath = path.join(releaseDirectory, zipName);
await fs.rm(zipPath, { force: true });
const zip = spawnSync("zip", ["-q", "-r", zipName, path.basename(appDirectory)], {
  cwd: releaseDirectory,
  encoding: "utf8",
});
if (zip.status !== 0) throw new Error(zip.stderr || "Could not create the Windows ZIP package.");

const digest = createHash("sha256").update(await fs.readFile(zipPath)).digest("hex");
await fs.writeFile(`${zipPath}.sha256.txt`, `${digest}  ${zipName}\n`);
await fs.rm(stagingDirectory, { recursive: true, force: true });

console.log(`Windows desktop package: ${zipPath}`);
console.log(`SHA-256: ${digest}`);
