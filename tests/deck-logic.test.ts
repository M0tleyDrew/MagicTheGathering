import assert from "node:assert/strict";
import test from "node:test";

import {
  archidektZone,
  applyConfirmedSwap,
  countedDecklistText,
  countEntries,
  isActualTokenCard,
  isCountedZone,
  isLandCard,
  normalizeHydratedZone,
  parseDeckText,
  primaryType,
  GAME_CHANGER_KEEP_BONUS,
  type ScryfallCard,
} from "../app/deck-logic.ts";

test("plain-text import separates deck zones and preserves exact printings", () => {
  const parsed = parseDeckText(`// Commander
1 Rin and Seri, Inseparable (MUL) 123 *CMDR*

Deck
1 Command Tower (CMM) 1006
8 Forest (FDN) 281

Maybeboard
1 Regal Caracal (AKH) 24

Sideboard
1 Generous Gift (MH1) 11

Tokens
2 Cat (TCMM) 15

Companion
1 Kaheera, the Orphanguard (MUL) 22`);

  assert.equal(parsed.deck.reduce((sum, entry) => sum + entry.quantity, 0), 10);
  assert.equal(parsed.deck.find((entry) => entry.name === "Command Tower")?.zone, "main");
  assert.equal(parsed.deck.find((entry) => entry.name.startsWith("Rin and Seri"))?.zone, "commander");
  assert.deepEqual(parsed.deck.find((entry) => entry.name === "Command Tower"), {
    name: "Command Tower",
    quantity: 1,
    commander: false,
    section: "Deck",
    groupLabels: ["Deck"],
    zoneSource: "inferred",
    zone: "main",
    set: "cmm",
    collectorNumber: "1006",
  });
  assert.equal(parsed.proposed.length, 1);
  assert.deepEqual(parsed.extras.map((entry) => entry.zone), ["sideboard", "token", "companion"]);
  assert.equal(parsed.entries.length, 7);
  assert.deepEqual(countEntries(parsed.entries), {
    byZone: { commander: 1, main: 9, maybeboard: 1, sideboard: 1, companion: 1, token: 2 },
    deckTotal: 10,
    outsideTotal: 5,
  });
});

test("front-face type controls sorting and land counting for modal cards", () => {
  const card = {
    id: "test",
    name: "Bala Ged Recovery // Bala Ged Sanctuary",
    cmc: 3,
    type_line: "Sorcery // Land",
    color_identity: ["G"],
    card_faces: [{ name: "Bala Ged Recovery", type_line: "Sorcery" }, { name: "Bala Ged Sanctuary", type_line: "Land" }],
  } satisfies ScryfallCard;
  assert.equal(primaryType(card), "Sorcery");
  assert.equal(isLandCard(card), false);
});

test("an included Archidekt category named Tokens stays in the main deck", () => {
  assert.equal(archidektZone([{ name: "Tokens", included: true }]), "main");
  assert.equal(archidektZone([{ name: "Sideboard", included: true }]), "sideboard");
  assert.equal(archidektZone([{ name: "Tokens", included: false }]), "token");
  assert.equal(archidektZone([{ name: "Considering", included: false }]), "maybeboard");
  assert.equal(archidektZone([{ name: "Cats", included: true, premier: true }]), "commander");
  assert.equal(archidektZone([{ name: "Commander", included: true }]), "commander");
});

test("cards that create tokens are not token cards", () => {
  const producer = {
    id: "producer",
    name: "Slug Wrangler",
    layout: "normal",
    cmc: 3,
    type_line: "Creature — Human Druid",
    oracle_text: "Create two 1/1 green Slug creature tokens.",
    color_identity: ["G"],
  } satisfies ScryfallCard;
  const token = {
    id: "token",
    name: "Slug",
    layout: "token",
    cmc: 0,
    type_line: "Token Creature — Slug",
    color_identity: ["G"],
  } satisfies ScryfallCard;
  assert.equal(isActualTokenCard(producer), false);
  assert.equal(isActualTokenCard(token), true);
  assert.equal(normalizeHydratedZone({ zone: "token", zoneSource: "category" }, producer), "main");
  assert.equal(normalizeHydratedZone({ zone: "token", zoneSource: "inferred" }, producer), "main");
  assert.equal(normalizeHydratedZone({ zone: "token", zoneSource: "explicit" }, producer), "token");
  assert.equal(normalizeHydratedZone({ zone: "token", zoneSource: "category" }, token), "token");
});

test("only commander and main zones count toward the deck total", () => {
  assert.equal(isCountedZone("commander"), true);
  assert.equal(isCountedZone("main"), true);
  assert.equal(isCountedZone("maybeboard"), false);
  assert.equal(isCountedZone("sideboard"), false);
  assert.equal(isCountedZone("companion"), false);
  assert.equal(isCountedZone("token"), false);
});

test("updated export preserves exact printings and excludes every off-deck zone", () => {
  const card = (id: string, name: string, type_line: string, set: string, collector_number: string): ScryfallCard => ({
    id, name, type_line, set, collector_number, cmc: 1, color_identity: [],
  });
  const output = countedDecklistText([
    { card: card("c", "Slug Commander", "Legendary Creature — Slug", "sbs", "001"), quantity: 1, commander: true, zone: "commander" },
    { card: card("m", "Banana Rock", "Artifact", "sbs", "042"), quantity: 1, zone: "main" },
    { card: card("s", "Side Slug", "Creature — Slug", "sbs", "099"), quantity: 4, zone: "sideboard" },
    { card: card("t", "Slug Token", "Token Creature — Slug", "tsbs", "1"), quantity: 2, zone: "token" },
    { card: card("x", "Maybe Banana", "Sorcery", "sbs", "100"), quantity: 1, zone: "maybeboard" },
  ]);

  assert.equal(output, "Commander\n1 Slug Commander (SBS) 001\n\nDeck\n1 Banana Rock (SBS) 042");
  assert.doesNotMatch(output, /Side Slug|Slug Token|Maybe Banana/);
});

test("a confirmed swap changes one slot and leaves auxiliary zones untouched", () => {
  const record = (recordId: string, zone: "main" | "sideboard" | "maybeboard", quantity = 1) => ({ recordId, zone, quantity, commander: false, locked: false, groupLabels: [zone] });
  const main = record("main-cut", "main", 2);
  const sideboard = record("side", "sideboard", 4);
  const proposal = record("proposal", "maybeboard");
  const before = [main, sideboard];
  const after = applyConfirmedSwap(before, proposal, main);

  assert.equal(before[0].quantity, 2, "the original state remains available for undo");
  assert.deepEqual(after, [
    { ...main, quantity: 1 },
    sideboard,
    { ...proposal, zone: "main", quantity: 1, commander: false, locked: false, section: "Deck", groupLabels: ["Deck"], zoneSource: "explicit" },
  ]);
  assert.equal(GAME_CHANGER_KEEP_BONUS, 22);
});

test("a confirmed sideboard addition moves one copy into the deck instead of cloning it", () => {
  const record = (recordId: string, zone: "main" | "sideboard", quantity = 1) => ({ recordId, zone, quantity, commander: false, locked: false, groupLabels: [zone] });
  const cut = record("main-cut", "main");
  const sideboard = record("sideboard-candidate", "sideboard");
  const after = applyConfirmedSwap([cut, sideboard], sideboard, cut);

  assert.equal(after.length, 1);
  assert.deepEqual(after[0], {
    ...sideboard,
    zone: "main",
    quantity: 1,
    commander: false,
    locked: false,
    section: "Deck",
    groupLabels: ["Deck"],
    zoneSource: "explicit",
  });
});

test("moving one of several sideboard copies preserves the rest with unique record ids", () => {
  const sideboard = { recordId: "sideboard-candidate", zone: "sideboard" as const, quantity: 2, commander: false, locked: false, groupLabels: ["Sideboard"] };
  const after = applyConfirmedSwap([sideboard], sideboard);
  const remaining = after.find((entry) => entry.zone === "sideboard");
  const entering = after.find((entry) => entry.zone === "main");

  assert.equal(remaining?.quantity, 1);
  assert.equal(entering?.quantity, 1);
  assert.notEqual(remaining?.recordId, entering?.recordId);
  assert.equal(entering?.recordId, "sideboard-candidate:main");
});
