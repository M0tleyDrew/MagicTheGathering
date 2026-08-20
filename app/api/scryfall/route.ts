const SCRYFALL_HEADERS = { Accept: "application/json", "User-Agent": "SaltyBananaSlug-MTG-Deck-Editor/1.0" };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const autocomplete = url.searchParams.get("autocomplete")?.trim();
  const named = url.searchParams.get("named")?.trim();
  if (!autocomplete && !named) return Response.json({ error: "Missing card query." }, { status: 400 });
  const target = autocomplete
    ? `https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(autocomplete.slice(0, 120))}&include_extras=true`
    : `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(named!.slice(0, 180))}`;
  const response = await fetch(target, { headers: SCRYFALL_HEADERS });
  const payload = await response.json();
  return Response.json(payload, { status: response.status, headers: { "Cache-Control": autocomplete ? "public, max-age=1800" : "public, max-age=86400" } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { identifiers?: Array<Record<string, string>> } | null;
  const identifiers = body?.identifiers;
  if (!Array.isArray(identifiers) || identifiers.length < 1 || identifiers.length > 75) return Response.json({ error: "Send between 1 and 75 card identifiers." }, { status: 400 });
  const response = await fetch("https://api.scryfall.com/cards/collection", {
    method: "POST", headers: { ...SCRYFALL_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ identifiers }),
  });
  const payload = await response.json();
  return Response.json(payload, { status: response.status, headers: { "Cache-Control": "public, max-age=43200" } });
}
