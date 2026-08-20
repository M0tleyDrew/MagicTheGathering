import { buildEdhrecSuggestions, edhrecCardlists, edhrecSlug } from "../../edhrec";

async function loadCommanderPage(names: string[]) {
  const orders = names.length === 2 ? [names, [...names].reverse()] : [names.slice(0, 1)];
  for (const order of orders) {
    const slug = order.map(edhrecSlug).join("-");
    const response = await fetch(`https://json.edhrec.com/pages/commanders/${slug}.json`, {
      headers: { Accept: "application/json", "User-Agent": "SaltyBananaSlug-MTG-Deck-Editor/1.1" },
    });
    if (!response.ok) continue;
    const data = await response.json() as Record<string, unknown>;
    const cardlists = edhrecCardlists(data);
    if (cardlists) return { slug, cardlists };
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const commanders = url.searchParams.getAll("commander").map((name) => name.trim()).filter(Boolean).slice(0, 2);
  if (!commanders.length) return Response.json({ error: "Choose a commander before asking EDHREC for ideas." }, { status: 400 });

  const page = await loadCommanderPage(commanders);
  if (!page) return Response.json({ error: "EDHREC doesn’t have a recommendation page for that commander combination yet." }, { status: 404 });

  return Response.json({
    commander: commanders.join(" + "),
    source: `https://edhrec.com/commanders/${page.slug}`,
    suggestions: buildEdhrecSuggestions(page.cardlists),
  }, { headers: { "Cache-Control": "public, max-age=1620, stale-while-revalidate=180" } });
}
