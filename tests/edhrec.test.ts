import assert from "node:assert/strict";
import test from "node:test";

import { buildEdhrecSuggestions, edhrecCardlists, edhrecSlug } from "../app/edhrec.ts";

test("current EDHREC commander payload shape yields ranked suggestions", () => {
  const payload = {
    container: {
      json_dict: {
        cardlists: [
          { tag: "topcards", header: "Top Cards", cardviews: [{ name: "Sol Ring", num_decks: 80, potential_decks: 100 }] },
          { tag: "highsynergycards", header: "High Synergy Cards", cardviews: [{ name: "Banana Slug", synergy: 0.42, inclusion: 0.61 }, { name: "Sol Ring", synergy: 0.01 }] },
        ],
      },
    },
  };
  const lists = edhrecCardlists(payload);
  assert.ok(lists);
  const ideas = buildEdhrecSuggestions(lists);
  assert.deepEqual(ideas.map((idea) => idea.name), ["Banana Slug", "Sol Ring"]);
  assert.equal(ideas[0].synergy, 0.42);
  assert.equal(ideas[1].inclusion, 0.8);
  assert.equal(ideas[1].label, "High Synergy Cards");
});

test("EDHREC slugs normalize punctuation and accents", () => {
  assert.equal(edhrecSlug("Éowyn, Shieldmaiden"), "eowyn-shieldmaiden");
  assert.equal(edhrecSlug("Keleth, Sunmane Familiar"), "keleth-sunmane-familiar");
});
