import { countEntries } from "../../deck-logic";
import { parseArchidektDeck } from "../../importers";

export async function GET(request: Request) {
  const rawUrl = new URL(request.url).searchParams.get("url") ?? "";
  const id = rawUrl.match(/(?:decks\/|^)(\d+)/)?.[1];
  if (!id) return Response.json({ error: "That doesn’t look like an Archidekt deck URL." }, { status: 400 });

  const response = await fetch(`https://archidekt.com/api/decks/${id}/`, {
    headers: { Accept: "application/json", "User-Agent": "SaltyBananaSlug-MTG-Deck-Editor/1.1" },
  });
  if (!response.ok) {
    return Response.json({
      error: response.status === 404
        ? "That Archidekt deck is private or missing."
        : "Archidekt didn’t return that deck. Paste its exported text instead.",
    }, { status: response.status });
  }

  const parsed = parseArchidektDeck(await response.json() as Record<string, unknown>);
  if (!countEntries(parsed.entries).deckTotal) return Response.json({ error: "Archidekt returned the deck, but no main-deck cards were found. Export as text and paste it for now." }, { status: 422 });

  return Response.json({
    name: parsed.name || `Archidekt Deck ${id}`,
    source: `https://archidekt.com/decks/${id}`,
    entries: parsed.entries,
    bracket: parsed.bracket,
  }, { headers: { "Cache-Control": "private, max-age=60" } });
}
