import { archidektZone, type DeckZone, type ParsedEntry } from "./deck-logic.ts";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

function bool(value: unknown, fallback: boolean) {
  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();
    if (["1", "true", "yes"].includes(normalizedValue)) return true;
    if (["0", "false", "no"].includes(normalizedValue)) return false;
  }
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return fallback;
}

function normalized(value: string) {
  return value.trim().toLowerCase();
}

type ImportResult = {
  name: string;
  entries: ParsedEntry[];
  bracket: number | null;
};

type Category = { name: string; included: boolean; premier: boolean };

function categoryFromObject(value: UnknownRecord, fallbackName = "Deck"): Category {
  return {
    name: String(value.name ?? fallbackName),
    included: bool(value.includedInDeck ?? value.included_in_deck, true),
    premier: bool(value.isPremier ?? value.is_premier, false),
  };
}

function archidektCategories(row: UnknownRecord, categoryMap: Map<string, Category>) {
  const raw = row.categories ?? row.category ?? [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.flatMap<Category>((value) => {
    if (value && typeof value === "object") {
      const object = value as UnknownRecord;
      const key = String(object.id ?? object.name ?? "");
      const mapped = categoryMap.get(key) ?? categoryMap.get(normalized(key));
      return [mapped ?? categoryFromObject(object, key || "Deck")];
    }
    const key = String(value ?? "");
    if (!key) return [];
    return [categoryMap.get(key) ?? categoryMap.get(normalized(key)) ?? { name: key, included: true, premier: false }];
  });
}

export function parseArchidektDeck(data: UnknownRecord): ImportResult {
  const categoryMap = new Map<string, Category>();
  for (const rawCategory of (Array.isArray(data.categories) ? data.categories : [])) {
    const categoryObject = record(rawCategory);
    const category = categoryFromObject(categoryObject);
    categoryMap.set(String(categoryObject.id ?? ""), category);
    categoryMap.set(normalized(category.name), category);
  }

  const nestedDeck = record(data.deck);
  const rows = (Array.isArray(data.cards) ? data.cards : Array.isArray(nestedDeck.cards) ? nestedDeck.cards : []) as UnknownRecord[];
  const entries: ParsedEntry[] = [];

  for (const rawRow of rows) {
    const row = record(rawRow);
    const printing = record(row.card ?? row.printing ?? row);
    const oracle = record(printing.oracleCard ?? printing.oracle_card ?? printing.oracle ?? printing);
    const edition = record(printing.edition);
    const name = String(oracle.name ?? printing.displayName ?? printing.name ?? row.name ?? "").trim();
    if (!name) continue;

    const categories = archidektCategories(row, categoryMap);
    const groupLabels = categories.map((category) => category.name).filter(Boolean);
    let zone = archidektZone(categories, {
      commander: bool(row.commander ?? row.isCommander ?? row.is_commander, false),
      companion: bool(row.companion ?? row.isCompanion ?? row.is_companion, false),
    });
    if (bool(row.sideboard ?? row.isSideboard ?? row.is_sideboard, false)) zone = "sideboard";
    if (bool(row.maybeboard ?? row.isMaybeboard ?? row.is_maybeboard, false)) zone = "maybeboard";

    entries.push({
      name,
      quantity: Math.max(1, Number(row.quantity ?? row.qty ?? 1) || 1),
      commander: zone === "commander",
      section: groupLabels.join(", ") || "Deck",
      groupLabels,
      zoneSource: "category",
      zone,
      scryfallId: typeof printing.uid === "string" ? printing.uid : typeof printing.scryfallId === "string" ? printing.scryfallId : undefined,
      set: typeof edition.editioncode === "string" ? edition.editioncode.toLowerCase() : typeof printing.set === "string" ? printing.set.toLowerCase() : undefined,
      collectorNumber: printing.collectorNumber == null ? printing.collector_number == null ? undefined : String(printing.collector_number) : String(printing.collectorNumber),
    });
  }

  const rawBracket = data.edhBracket ?? data.edh_bracket;
  const bracket = typeof rawBracket === "number" && rawBracket >= 1 && rawBracket <= 5 ? rawBracket : null;
  return { name: String(data.name ?? "Imported Archidekt Deck"), entries, bracket };
}

function moxfieldZone(boardName: string): DeckZone {
  const board = normalized(boardName).replace(/[\s_-]+/g, "");
  if (["commanders", "commander", "partners", "partner"].includes(board)) return "commander";
  if (["maybeboard", "considering"].includes(board)) return "maybeboard";
  if (["sideboard", "wishboard"].includes(board)) return "sideboard";
  if (["companions", "companion"].includes(board)) return "companion";
  if (["tokens", "token", "attractions", "contraptions", "planes", "schemes", "stickers"].includes(board)) return "token";
  return "main";
}

function boardRows(value: unknown) {
  const board = record(value);
  const rawRows = board.cards ?? value;
  if (Array.isArray(rawRows)) return rawRows.map(record);
  return Object.values(record(rawRows)).map(record);
}

export function parseMoxfieldDeck(data: UnknownRecord): ImportResult {
  const suppliedBoards = record(data.boards);
  const boards = Object.keys(suppliedBoards).length ? suppliedBoards : {
    mainboard: data.mainboard,
    commanders: data.commanders,
    maybeboard: data.maybeboard,
    sideboard: data.sideboard,
    companions: data.companions,
    tokens: data.tokens,
  };
  const entries: ParsedEntry[] = [];

  for (const [boardName, rawBoard] of Object.entries(boards)) {
    for (const row of boardRows(rawBoard)) {
      const card = record(row.card ?? row);
      let zone = moxfieldZone(boardName);
      if (bool(card.isToken ?? card.is_token, false)) zone = "token";
      const name = String(card.name ?? row.name ?? "").trim();
      if (!name) continue;
      entries.push({
        name,
        quantity: Math.max(1, Number(row.quantity ?? row.qty ?? 1) || 1),
        commander: zone === "commander",
        section: boardName,
        groupLabels: [boardName],
        zoneSource: "explicit",
        zone,
        scryfallId: typeof card.scryfall_id === "string" ? card.scryfall_id : typeof card.scryfallId === "string" ? card.scryfallId : undefined,
        set: typeof card.set === "string" ? card.set.toLowerCase() : undefined,
        collectorNumber: card.cn == null ? card.collector_number == null ? undefined : String(card.collector_number) : String(card.cn),
      });
    }
  }

  const bracketCandidates = [data.userBracket, data.bracket, data.autoBracket];
  const bracket = bracketCandidates.find((value) => typeof value === "number" && value >= 1 && value <= 5) as number | undefined;
  return { name: String(data.name ?? "Imported Moxfield Deck"), entries, bracket: bracket ?? null };
}
