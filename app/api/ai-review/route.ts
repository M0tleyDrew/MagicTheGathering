const MAX_INPUT_CHARS = 60_000;

export async function GET() {
  return Response.json({ available: Boolean(process.env.OPENAI_API_KEY) }, { headers: { "Cache-Control": "no-store" } });
}

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : [];
    return content.flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const value = part as Record<string, unknown>;
      return value.type === "output_text" && typeof value.text === "string" ? [value.text] : [];
    });
  }).join("\n").trim();
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({
      error: "No OpenAI API key is configured. The local ranking still works; in the desktop app, add a key under Settings.",
      setupRequired: true,
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "The advisor request was not valid JSON." }, { status: 400 });
  }
  const deckContext = JSON.stringify(input);
  if (deckContext.length > MAX_INPUT_CHARS) return Response.json({ error: "That deck review payload is unexpectedly large." }, { status: 413 });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
      instructions: [
        "You are the optional reasoning layer inside SaltyBananaSlug's Commander deck editor.",
        "Use the supplied Scryfall facts, EDHREC evidence, deterministic scores, and exact printings; do not invent card text or popularity data.",
        "Never recommend cutting a land, commander, or protected card.",
        "Treat a Scryfall Game Changer as a strong default keep and explicitly explain any rare case where cutting one is still sensible.",
        "For every proposed or imported-sideboard addition, recommend up to three supplied cut candidates, explain the exchange in plain language, and mention roles or mana-curve costs.",
        "Treat sideboard cards as eligible additions that remain outside the 100 until the user confirms a move or swap.",
        "Popularity is evidence, not an order. Respect the stated strategy and selected bracket.",
        "Be concise, decisive, and a little playfully salty. Do not claim that you edited the deck.",
      ].join(" "),
      input: deckContext,
      max_output_tokens: 1800,
    }),
  });

  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error && typeof payload.error === "object" ? (payload.error as Record<string, unknown>).message : null;
    return Response.json({ error: typeof error === "string" ? error : "OpenAI did not return a deck review." }, { status: response.status, headers: { "Cache-Control": "no-store" } });
  }

  const review = outputText(payload);
  if (!review) return Response.json({ error: "OpenAI returned no readable review text." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  return Response.json({ review }, { headers: { "Cache-Control": "no-store" } });
}
