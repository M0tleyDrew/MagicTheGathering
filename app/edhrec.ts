type CardView = {
  name?: string;
  synergy?: number;
  inclusion?: number;
  num_decks?: number;
  potential_decks?: number;
};

export type EdhrecSuggestion = {
  name: string;
  tag: string;
  label: string;
  synergy: number | null;
  numDecks: number | null;
  potentialDecks: number | null;
  inclusion: number | null;
};

export function edhrecSlug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function edhrecCardlists(data: Record<string, unknown>) {
  const container = data.container as Record<string, unknown> | undefined;
  const json = container?.json_dict as Record<string, unknown> | undefined;
  return Array.isArray(json?.cardlists) ? json.cardlists as Array<Record<string, unknown>> : null;
}

export function buildEdhrecSuggestions(cardlists: Array<Record<string, unknown>>, limit = 36): EdhrecSuggestion[] {
  const priority = new Map([
    ["highsynergycards", 0],
    ["newcards", 1],
    ["topcards", 2],
    ["gamechangers", 3],
  ]);
  const lists = [...cardlists].sort((a, b) => (priority.get(String(a.tag)) ?? 10) - (priority.get(String(b.tag)) ?? 10));
  const suggestions = new Map<string, EdhrecSuggestion>();

  for (const list of lists) {
    const tag = String(list.tag ?? "recommended");
    const label = String(list.header ?? "Recommended cards");
    const cards = Array.isArray(list.cardviews) ? list.cardviews as CardView[] : [];
    for (const card of cards) {
      const name = card.name?.trim();
      if (!name) continue;
      const used = Number(card.num_decks ?? 0);
      const possible = Number(card.potential_decks ?? 0);
      const candidate: EdhrecSuggestion = {
        name,
        tag,
        label,
        synergy: typeof card.synergy === "number" ? card.synergy : null,
        numDecks: used || null,
        potentialDecks: possible || null,
        inclusion: typeof card.inclusion === "number" ? card.inclusion : possible > 0 ? used / possible : null,
      };
      const key = name.toLowerCase();
      const existing = suggestions.get(key);
      suggestions.set(key, existing ? {
        ...existing,
        synergy: existing.synergy ?? candidate.synergy,
        numDecks: existing.numDecks ?? candidate.numDecks,
        potentialDecks: existing.potentialDecks ?? candidate.potentialDecks,
        inclusion: existing.inclusion ?? candidate.inclusion,
      } : candidate);
      if (suggestions.size >= limit) break;
    }
    if (suggestions.size >= limit) break;
  }
  return [...suggestions.values()];
}
