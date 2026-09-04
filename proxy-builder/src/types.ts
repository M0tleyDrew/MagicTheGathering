export type CardColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';

export type CardStyle =
  | 'standard'
  | 'borderless'
  | 'full-art'
  | 'full-art-land'
  | 'token'
  | 'minimal-token'
  | 'retro';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'mythic' | 'special';

export interface CardDraft {
  id: string;
  name: string;
  manaCost: string;
  manaValue: number;
  colors: CardColor[];
  typeLine: string;
  rulesText: string;
  flavorText: string;
  power: string;
  toughness: string;
  loyalty: string;
  defense: string;
  style: CardStyle;
  rarity: Rarity;
  setCode: string;
  collectorNumber: string;
  artistCredit: string;
  footerText: string;
  artDataUrl: string;
  setSymbolDataUrl: string;
  sourceScryfallId?: string;
}

export interface ScryfallCardSummary {
  id: string;
  name: string;
  mana_cost?: string;
  cmc: number;
  colors?: string[];
  color_identity?: string[];
  type_line: string;
  oracle_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  set: string;
  collector_number: string;
  rarity: string;
  artist?: string;
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
    png?: string;
    art_crop?: string;
    border_crop?: string;
  };
  card_faces?: Array<{
    name: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    flavor_text?: string;
    power?: string;
    toughness?: string;
    loyalty?: string;
    defense?: string;
    image_uris?: ScryfallCardSummary['image_uris'];
  }>;
}
