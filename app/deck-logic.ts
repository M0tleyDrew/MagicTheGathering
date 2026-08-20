export type DeckZone = "main" | "commander" | "maybeboard" | "sideboard" | "token" | "companion";

export type CardFace = {
  name: string;
  mana_cost?: string;
  oracle_text?: string;
  type_line?: string;
  image_uris?: Record<string, string>;
};

export type ScryfallCard = {
  id: string;
  oracle_id?: string;
  name: string;
  layout?: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  color_identity: string[];
  image_uris?: Record<string, string>;
  card_faces?: CardFace[];
  prices?: Record<string, string | null>;
  legalities?: Record<string, string>;
  rarity?: string;
  set?: string;
  set_name?: string;
  collector_number?: string;
  edhrec_rank?: number | null;
  game_changer?: boolean;
  scryfall_uri?: string;
};

export type ParsedEntry = {
  name: string;
  quantity: number;
  commander?: boolean;
  section?: string;
  groupLabels?: string[];
  zoneSource?: "explicit" | "inferred" | "category";
  zone: DeckZone;
  set?: string;
  collectorNumber?: string;
  scryfallId?: string;
};

export type ParsedDeck = {
  entries: ParsedEntry[];
  deck: ParsedEntry[];
  proposed: ParsedEntry[];
  extras: ParsedEntry[];
};

export const countedZones = ["main", "commander"] as const;
export const auxiliaryZones = ["sideboard", "token", "companion"] as const;
export const allDeckZones: DeckZone[] = ["commander", "main", "maybeboard", "sideboard", "companion", "token"];
export const GAME_CHANGER_KEEP_BONUS = 22;

export function isCountedZone(zone: DeckZone) {
  return (countedZones as readonly DeckZone[]).includes(zone);
}

export function countEntries(entries: Array<Pick<ParsedEntry, "quantity" | "zone">>) {
  const byZone = Object.fromEntries(allDeckZones.map((zone) => [zone, 0])) as Record<DeckZone, number>;
  for (const entry of entries) byZone[entry.zone] += entry.quantity;
  return { byZone, deckTotal: byZone.commander + byZone.main, outsideTotal: byZone.maybeboard + byZone.sideboard + byZone.companion + byZone.token };
}

export function partitionEntries<T extends { zone: DeckZone }>(entries: T[]) {
  return {
    deck: entries.filter((entry) => isCountedZone(entry.zone)),
    proposed: entries.filter((entry) => entry.zone === "maybeboard"),
    extras: entries.filter((entry) => (auxiliaryZones as readonly DeckZone[]).includes(entry.zone)),
  };
}

export type SwappableZoneEntry = {
  recordId: string;
  quantity: number;
  commander: boolean;
  locked: boolean;
  section?: string;
  groupLabels: string[];
  zoneSource?: "explicit" | "inferred" | "category";
  zone: DeckZone;
};

export function applyConfirmedSwap<T extends SwappableZoneEntry>(workspace: T[], candidate: T, cut?: T): T[] {
  let next = workspace;

  const candidateInWorkspace = next.find((entry) => entry.recordId === candidate.recordId);
  if (candidateInWorkspace && !isCountedZone(candidateInWorkspace.zone)) {
    next = candidateInWorkspace.quantity > 1
      ? next.map((entry) => entry.recordId === candidate.recordId ? { ...entry, quantity: entry.quantity - 1 } : entry)
      : next.filter((entry) => entry.recordId !== candidate.recordId);
  }

  if (cut) {
    next = cut.quantity > 1
      ? next.map((entry) => entry.recordId === cut.recordId ? { ...entry, quantity: entry.quantity - 1 } : entry)
      : next.filter((entry) => entry.recordId !== cut.recordId);
  }

  let enteringRecordId = candidate.recordId;
  let suffix = 1;
  while (next.some((entry) => entry.recordId === enteringRecordId)) {
    enteringRecordId = `${candidate.recordId}:main${suffix === 1 ? "" : `-${suffix}`}`;
    suffix += 1;
  }
  const entering = {
    ...candidate,
    recordId: enteringRecordId,
    quantity: 1,
    commander: false,
    locked: false,
    section: "Deck",
    groupLabels: ["Deck"],
    zoneSource: "explicit" as const,
    zone: "main" as const,
  };
  return [...next, entering];
}

export const normalizeName = (value: string) => value.toLowerCase().replace(/\s*\/\/\s*/g, " // ").trim();

export function zoneFromSection(section: string, line = ""): DeckZone {
  const source = section.toLowerCase();
  if (/\bcommand(?:er|ers)?\b|\bleader(?:s)?\b/.test(source) || /\*cmdr\*/i.test(line)) return "commander";
  if (/\btoken(?:s)?\b|\bemblem(?:s)?\b/.test(source)) return "token";
  if (/\bmaybe(?:board)?\b|\bconsidering\b|\bacquireboard\b/.test(source)) return "maybeboard";
  if (/\bside(?:\s*board)?\b|\bwishboard\b/.test(source)) return "sideboard";
  if (/\bcompanion(?:s)?\b/.test(source)) return "companion";
  return "main";
}

export type ArchidektCategory = {
  name: string;
  included: boolean;
  premier?: boolean;
};

/**
 * Most Archidekt categories are user-defined labels, but Archidekt treats a
 * few reserved board names specially. In particular, its API can report a
 * category literally named "Sideboard" as includedInDeck=true while the deck
 * page still excludes those cards from Deck Size. Mirror that behavior here.
 * "Tokens" remains an ordinary main-deck label when included, because people
 * commonly use it for playable cards that create tokens.
 */
export function archidektZone(
  categories: ArchidektCategory[],
  flags: { commander?: boolean; companion?: boolean } = {},
): DeckZone {
  const reservedNames = categories.map((category) => category.name.trim().toLowerCase().replace(/[\s_-]+/g, ""));
  if (flags.commander || categories.some((category) => category.premier) || reservedNames.some((name) => ["commander", "commanders", "leader", "leaders"].includes(name))) return "commander";
  if (flags.companion || reservedNames.some((name) => ["companion", "companions"].includes(name))) return "companion";
  if (reservedNames.some((name) => ["sideboard", "wishboard"].includes(name))) return "sideboard";
  if (reservedNames.some((name) => ["maybeboard", "maybe", "considering", "acquireboard"].includes(name))) return "maybeboard";

  const excluded = categories.filter((category) => !category.included);
  if (!excluded.length) return "main";
  const excludedZone = zoneFromSection(excluded.map((category) => category.name).join(", "));
  return excludedZone === "main" ? "maybeboard" : excludedZone;
}

export function isActualTokenCard(card: ScryfallCard) {
  if (["token", "double_faced_token", "emblem"].includes(card.layout ?? "")) return true;
  const typeLines = [card.type_line, ...(card.card_faces ?? []).map((face) => face.type_line ?? "")];
  return typeLines.some((typeLine) => /^(?:token\b|emblem\b)/i.test(typeLine.trim()));
}

export function normalizeHydratedZone(entry: Pick<ParsedEntry, "zone" | "zoneSource">, card: ScryfallCard): DeckZone {
  // Text exports and user categories sometimes call a group "Tokens" even
  // though it contains playable cards that create tokens. Once Scryfall tells
  // us the object is a normal card, an inferred token label becomes a group,
  // not a deck zone. Explicit token boards remain outside the deck.
  if (entry.zone === "token" && entry.zoneSource !== "explicit" && !isActualTokenCard(card)) return "main";
  return entry.zone;
}

function cleanSectionHeader(line: string) {
  return line.replace(/^(?:\/\/|#+)\s*/, "").replace(/:$/, "").trim();
}

function parsePrinting(rawName: string) {
  let value = rawName
    .replace(/\s+\*CMDR\*\s*$/i, "")
    .replace(/\s+\*[A-Z]+\*\s*$/i, "")
    .replace(/\s+\^[^^]+\^\s*$/, "")
    .replace(/\s+\[[^\]]+\]\s*$/, "")
    .trim();

  const printing = value.match(/^(.*?)\s+\(([A-Za-z0-9]{2,8})\)\s+([^\s]+)(?:\s+.*)?$/);
  if (!printing) return { name: value };
  value = printing[1].trim();
  return { name: value, set: printing[2].toLowerCase(), collectorNumber: printing[3] };
}

export function parseDeckText(text: string): ParsedDeck {
  let section = "Deck";
  const entries: ParsedEntry[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (!/^\d/.test(line)) {
      if (line.startsWith("//") || line.startsWith("#")) {
        const possibleHeader = cleanSectionHeader(line);
        if (/command|leader|deck|main|creature|instant|sorcery|artifact|enchantment|planeswalker|battle|land|side|maybe|considering|token|emblem|companion/i.test(possibleHeader)) section = possibleHeader;
      } else {
        section = cleanSectionHeader(line);
      }
      continue;
    }

    const match = line.match(/^(\d+)\s*x?\s*[,;-]?\s*(.+)$/i);
    if (!match) continue;
    const quantity = Number(match[1]);
    if (!Number.isFinite(quantity) || quantity < 1) continue;

    const zone = zoneFromSection(section, line);
    const parsed = parsePrinting(match[2]);
    if (!parsed.name) continue;
    entries.push({
      ...parsed,
      quantity,
      commander: zone === "commander",
      section,
      groupLabels: [section],
      zoneSource: "inferred",
      zone,
    });
  }

  const combined = new Map<string, ParsedEntry>();
  for (const entry of entries) {
    const printing = entry.scryfallId ?? `${entry.set ?? ""}:${entry.collectorNumber ?? ""}`;
    const key = `${normalizeName(entry.name)}::${printing}::${entry.zone}`;
    const existing = combined.get(key);
    combined.set(key, existing ? { ...existing, quantity: existing.quantity + entry.quantity } : entry);
  }

  const parsed = [...combined.values()];
  const partitions = partitionEntries(parsed);
  return {
    entries: parsed,
    ...partitions,
  };
}

export const typeOrder = ["Commander", "Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land", "Other"] as const;

export function primaryType(card: ScryfallCard, commander = false) {
  if (commander) return "Commander";
  const frontType = (card.card_faces?.[0]?.type_line ?? card.type_line.split(" // ")[0]).toLowerCase();
  for (const type of typeOrder.slice(1, -1)) if (frontType.includes(type.toLowerCase())) return type;
  return "Other";
}

export function isLandCard(card: ScryfallCard) {
  return primaryType(card) === "Land";
}

export function printingLabel(card: ScryfallCard) {
  const set = card.set?.toUpperCase();
  if (!set) return "Unknown printing";
  return `${set}${card.collector_number ? ` #${card.collector_number}` : ""}`;
}

export type ExportableDeckEntry = {
  card: ScryfallCard;
  quantity: number;
  commander?: boolean;
  zone: DeckZone;
};

export function exactPrintLine(entry: ExportableDeckEntry) {
  const set = entry.card.set?.toUpperCase();
  const printing = set ? ` (${set})${entry.card.collector_number ? ` ${entry.card.collector_number}` : ""}` : "";
  return `${entry.quantity} ${entry.card.name}${printing}`;
}

export function countedDecklistText(entries: ExportableDeckEntry[]) {
  const counted = entries.filter((entry) => isCountedZone(entry.zone));
  const commanders = counted.filter((entry) => entry.zone === "commander" || entry.commander).sort((a, b) => a.card.name.localeCompare(b.card.name));
  const main = counted.filter((entry) => entry.zone === "main" && !entry.commander).sort((a, b) => {
    const typeDelta = typeOrder.indexOf(primaryType(a.card)) - typeOrder.indexOf(primaryType(b.card));
    return typeDelta || a.card.name.localeCompare(b.card.name);
  });
  return `${commanders.length ? `Commander\n${commanders.map(exactPrintLine).join("\n")}\n\n` : ""}Deck\n${main.map(exactPrintLine).join("\n")}`;
}
