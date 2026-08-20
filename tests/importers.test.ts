import assert from "node:assert/strict";
import test from "node:test";

import { countEntries } from "../app/deck-logic.ts";
import { parseArchidektDeck, parseMoxfieldDeck } from "../app/importers.ts";

test("Archidekt categories remain labels while explicit off-deck boards remain zones", () => {
  const parsed = parseArchidektDeck({
    name: "Slug Audit",
    edhBracket: 3,
    categories: [
      { id: 1, name: "Commander", includedInDeck: "true", isPremier: "true" },
      { id: 2, name: "Tokens", includedInDeck: "true" },
      { id: 3, name: "Sideboard", includedInDeck: "true" },
      { id: 4, name: "Maybeboard", includedInDeck: false },
      { id: 5, name: "Actual Tokens", includedInDeck: "false" },
    ],
    cards: [
      { quantity: 1, categories: [1], card: { uid: "commander-id", oracleCard: { name: "Slug Commander" }, edition: { editioncode: "SBS" }, collectorNumber: "1" } },
      { quantity: 95, categories: [2], card: { uid: "maker-id", oracleCard: { name: "Banana Maker" }, edition: { editioncode: "SBS" }, collectorNumber: 2 } },
      { quantity: 4, categories: [3], card: { oracleCard: { name: "Side Slug" } } },
      { quantity: 2, categories: [4], card: { oracleCard: { name: "Maybe Slug" } } },
      { quantity: 3, categories: [5], card: { oracleCard: { name: "Slug Token" } } },
    ],
  });

  assert.equal(parsed.name, "Slug Audit");
  assert.equal(parsed.bracket, 3);
  assert.deepEqual(parsed.entries.map((entry) => entry.zone), ["commander", "main", "sideboard", "maybeboard", "token"]);
  assert.deepEqual(parsed.entries[1].groupLabels, ["Tokens"]);
  assert.equal(parsed.entries[1].set, "sbs");
  assert.equal(parsed.entries[1].collectorNumber, "2");
  assert.deepEqual(countEntries(parsed.entries), {
    byZone: { commander: 1, main: 95, maybeboard: 2, sideboard: 4, companion: 0, token: 3 },
    deckTotal: 96,
    outsideTotal: 9,
  });
});

test("Archidekt deck-size semantics count commander and exclude its reserved Sideboard group", () => {
  const parsed = parseArchidektDeck({
    name: "Krenko-style live regression",
    categories: [
      { id: 1, name: "Commander", includedInDeck: true, isPremier: true },
      { id: 2, name: "Creature", includedInDeck: true, isPremier: false },
      { id: 3, name: "Sideboard", includedInDeck: true, isPremier: false },
      { id: 4, name: "Tokens & Extras", includedInDeck: false, isPremier: false },
    ],
    cards: [
      { quantity: 1, categories: ["Commander"], card: { oracleCard: { name: "Krenko, Mob Boss" } } },
      { quantity: 99, categories: ["Creature"], card: { oracleCard: { name: "Main-deck Goblins" } } },
      { quantity: 19, categories: ["Sideboard", "Creature"], card: { oracleCard: { name: "Sideboard Goblins" } } },
      { quantity: 6, categories: ["Tokens & Extras"], card: { oracleCard: { name: "Goblin Token" } } },
    ],
  });

  assert.deepEqual(parsed.entries.map((entry) => entry.zone), ["commander", "main", "sideboard", "token"]);
  assert.deepEqual(countEntries(parsed.entries), {
    byZone: { commander: 1, main: 99, maybeboard: 0, sideboard: 19, companion: 0, token: 6 },
    deckTotal: 100,
    outsideTotal: 25,
  });
});

test("Archidekt recognizes a sideboard category object when the category table is absent", () => {
  const parsed = parseArchidektDeck({
    cards: [{ quantity: 7, category: { name: "Sideboard", includedInDeck: "false" }, card: { name: "Sideboard Card" } }],
  });
  assert.equal(parsed.entries[0].zone, "sideboard");
  assert.equal(countEntries(parsed.entries).deckTotal, 0);
});

test("Moxfield boards are explicit and preserve exact printings", () => {
  const row = (name: string, quantity: number, set: string, cn: string) => ({ quantity, card: { name, scryfall_id: `${name}-id`, set, cn } });
  const parsed = parseMoxfieldDeck({
    name: "Mox Slugs",
    userBracket: 4,
    boards: {
      commanders: { cards: { one: row("Slug Commander", 1, "sbs", "1") } },
      mainboard: { cards: { two: row("Banana Land", 99, "sbs", "002") } },
      maybeboard: { cards: { three: row("Maybe Banana", 2, "sbs", "3") } },
      sideboard: { cards: { four: row("Side Banana", 4, "sbs", "4") } },
      companions: { cards: { five: row("Companion Slug", 1, "sbs", "5") } },
      tokens: { cards: { six: row("Slug Token", 6, "tsbs", "1") } },
    },
  });

  assert.equal(parsed.bracket, 4);
  assert.deepEqual(parsed.entries.map((entry) => entry.zone), ["commander", "main", "maybeboard", "sideboard", "companion", "token"]);
  assert.equal(parsed.entries[1].set, "sbs");
  assert.equal(parsed.entries[1].collectorNumber, "002");
  assert.equal(parsed.entries.every((entry) => entry.zoneSource === "explicit"), true);
  assert.deepEqual(countEntries(parsed.entries), {
    byZone: { commander: 1, main: 99, maybeboard: 2, sideboard: 4, companion: 1, token: 6 },
    deckTotal: 100,
    outsideTotal: 13,
  });
});
