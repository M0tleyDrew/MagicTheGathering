import { countEntries } from "../../deck-logic";
import { parseMoxfieldDeck } from "../../importers";

export async function GET(request: Request) {
  const rawUrl = new URL(request.url).searchParams.get("url") ?? "";
  const trimmed = rawUrl.trim();
  const id = trimmed.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]{8,})/i)?.[1]
    ?? (/^[A-Za-z0-9_-]{8,}$/.test(trimmed) ? trimmed : null);
  if (!id) return Response.json({ error: "That doesn’t look like a Moxfield deck URL." }, { status: 400 });

  const response = await fetch(`https://api2.moxfield.com/v3/decks/all/${id}`, {
    headers: { Accept: "application/json", "User-Agent": "SaltyBananaSlug-MTG-Deck-Editor/1.1" },
  });

  if (!response.ok) {
    const blocked = response.status === 401 || response.status === 403;
    return Response.json({
      error: blocked
        ? "Moxfield currently blocks third-party link imports. In Moxfield, choose More → Export → Copy for Moxfield, then paste it below. The editor will preserve its sets, printings, and zones."
        : response.status === 404
          ? "That Moxfield deck is private or missing."
          : "Moxfield didn’t return that deck. Use its exported text below instead.",
      fallback: "moxfield-export",
    }, { status: blocked ? 503 : response.status });
  }

  const parsed = parseMoxfieldDeck(await response.json() as Record<string, unknown>);
  if (!countEntries(parsed.entries).deckTotal) return Response.json({ error: "Moxfield returned the deck, but no main-deck cards were found. Use its exported text instead." }, { status: 422 });
  return Response.json({
    name: parsed.name,
    source: `https://moxfield.com/decks/${id}`,
    entries: parsed.entries,
    bracket: parsed.bracket,
  }, { headers: { "Cache-Control": "private, max-age=60" } });
}
