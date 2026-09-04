import type { ScryfallCardSummary } from '../types';

const API_ROOT = 'https://api.scryfall.com';

export async function searchScryfallCards(query: string): Promise<ScryfallCardSummary[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const response = await fetch(`${API_ROOT}/cards/search?q=${encodeURIComponent(trimmed)}&unique=prints`, {
    headers: {
      Accept: 'application/json;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`Scryfall search failed (${response.status})`);
  }

  const payload = (await response.json()) as { data?: ScryfallCardSummary[] };
  return (payload.data ?? []).slice(0, 24);
}

export function getPreferredArt(card: ScryfallCardSummary): string {
  const imageUris = card.image_uris ?? card.card_faces?.[0]?.image_uris;
  return imageUris?.art_crop ?? imageUris?.large ?? imageUris?.normal ?? imageUris?.png ?? '';
}
