"use client";

import { useEffect, useMemo, useState } from "react";
import {
  allDeckZones,
  applyConfirmedSwap,
  countEntries,
  countedDecklistText,
  exactPrintLine,
  GAME_CHANGER_KEEP_BONUS,
  isCountedZone,
  isLandCard,
  normalizeHydratedZone,
  normalizeName,
  parseDeckText,
  primaryType,
  printingLabel,
  type DeckZone,
  type ParsedEntry,
  type ScryfallCard,
  typeOrder,
} from "./deck-logic";

type DeckCard = {
  recordId: string;
  card: ScryfallCard;
  quantity: number;
  commander: boolean;
  locked: boolean;
  section?: string;
  groupLabels: string[];
  zoneSource?: "explicit" | "inferred" | "category";
  zone: DeckZone;
};
type EdhrecIdea = { entry: DeckCard; tag: string; label: string; synergy: number | null; inclusion: number | null; numDecks: number | null; potentialDecks: number | null };
type View = "deck" | "proposed" | "swaps";
type PendingImport = {
  name: string;
  entries: DeckCard[];
  bracket: number | null;
  bracketSource: string | null;
  warnings: string[];
};

const demoDeck = `Commander
1 Rin and Seri, Inseparable

Deck
1 Sol Ring
1 Arcane Signet
1 Swords to Plowshares
1 Beast Within
1 Generous Gift
1 Cultivate
1 Farseek
1 Guardian Project
1 Beast Whisperer
1 Pack Leader
1 Feline Sovereign
1 King of the Pride
1 Loyal Warhound
1 Prowling Serpopard
1 Jazal Goldmane
1 Maskwood Nexus
1 Impact Tremors
1 Path of Ancestry
1 Command Tower
8 Forest
6 Plains
5 Mountain`;

function imageFor(card: ScryfallCard, size: "small" | "normal" = "normal") {
  return card.image_uris?.[size] ?? card.card_faces?.[0]?.image_uris?.[size] ?? "";
}
function faceImage(card: ScryfallCard, face: number) { return card.card_faces?.[face]?.image_uris?.normal ?? imageFor(card); }
function oracleText(card: ScryfallCard) {
  return card.oracle_text ?? card.card_faces?.map((face) => face.oracle_text).filter(Boolean).join("\n\n") ?? "";
}
function classify(card: ScryfallCard) {
  const text = oracleText(card).toLowerCase();
  const type = card.type_line.toLowerCase();
  const roles: string[] = [];
  if (isLandCard(card)) roles.push("Land");
  if (/add \{|treasure token|search your library for (?:a|up to .*?) land|costs? .* less/.test(text)) roles.push("Ramp");
  if (/draw (?:a|two|three|that many|cards)|exile the top .*you may (?:play|cast)|look at the top/.test(text)) roles.push("Draw");
  if (/destroy target|exile target|counter target|return target .* to its owner|deals? \d+ damage to (?:any|target)/.test(text)) roles.push("Interaction");
  if (/(destroy|exile) all|each creature gets|all creatures get/.test(text)) roles.push("Board wipe");
  if (/hexproof|indestructible|phase out|protection from|counter target spell.*targets/.test(text)) roles.push("Protection");
  if (/from your graveyard|return target .* card from .* graveyard|cast .* from your graveyard/.test(text)) roles.push("Recursion");
  if (/search your library for (?:a|an|up to|any|two|three) (?!basic land)/.test(text)) roles.push("Tutor");
  if (/create .* token/.test(text)) roles.push("Tokens");
  if (/you gain|gain that much life|lifelink/.test(text)) roles.push("Lifegain");
  if (/you win the game|each opponent loses|damage to each opponent|double .* damage/.test(text)) roles.push("Finisher");
  if (type.includes("creature")) roles.push("Creature");
  return [...new Set(roles)];
}

const roleTargets: Record<string, number> = { Land: 37, Ramp: 10, Draw: 10, Interaction: 10, "Board wipe": 3, Protection: 3, Recursion: 3 };
const conceptWords = ["artifact", "aura", "attack", "combat", "counter", "creature", "discard", "dog", "cat", "dragon", "equipment", "exile", "graveyard", "land", "lifegain", "mill", "sacrifice", "spell", "token", "treasure", "vampire", "zombie"];

function countRoles(deck: DeckCard[]) {
  const counts: Record<string, number> = {};
  for (const entry of deck) for (const role of classify(entry.card)) counts[role] = (counts[role] ?? 0) + entry.quantity;
  return counts;
}

function commanderSynergy(card: ScryfallCard, commanderInput: DeckCard | DeckCard[] | undefined, strategy: string) {
  const commanders = Array.isArray(commanderInput) ? commanderInput : commanderInput ? [commanderInput] : [];
  if (!commanders.length) return { score: 0, matches: [] as string[] };
  const commanderText = commanders.map((commander) => `${commander.card.type_line} ${oracleText(commander.card)}`).join(" ").toLowerCase();
  const cardText = `${card.type_line} ${oracleText(card)}`.toLowerCase();
  const strategyText = strategy.toLowerCase();
  const commanderConcepts = conceptWords.filter((word) => commanderText.includes(word));
  const matches = commanderConcepts.filter((word) => cardText.includes(word));
  for (const word of conceptWords.filter((item) => strategyText.includes(item) && cardText.includes(item))) if (!matches.includes(word)) matches.push(word);
  let score = Math.min(20, matches.length * 4);
  const commanderSubtype = commanders.flatMap((commander) => commander.card.type_line.split("—")[1]?.trim().toLowerCase().split(/\s+/) ?? []);
  const cardSubtype = card.type_line.split("—")[1]?.trim().toLowerCase().split(/\s+/) ?? [];
  const sharedSubtype = cardSubtype.filter((type) => commanderSubtype.includes(type));
  if (sharedSubtype.length) { score += 6; matches.push(...sharedSubtype.filter((type) => !matches.includes(type))); }
  return { score: Math.min(26, score), matches };
}

function isBasic(card: ScryfallCard) { return /basic land/i.test(card.type_line); }

type CandidateAnalysis = { score: number; verdict: string; tone: string; reasons: string[]; cautions: string[]; roles: string[]; legal: boolean };

function analyzeCandidate(entry: DeckCard, deck: DeckCard[], strategy: string, power: number | null): CandidateAnalysis {
  const card = entry.card;
  const commanders = deck.filter((item) => item.commander);
  const roles = classify(card);
  const counts = countRoles(deck);
  const reasons: string[] = [];
  const cautions: string[] = [];
  const duplicate = deck.some((item) => (item.card.oracle_id ?? item.card.id) === (card.oracle_id ?? card.id)) && !isBasic(card);
  const commanderColors = [...new Set(commanders.flatMap((item) => item.card.color_identity))];
  const colorLegal = !commanders.length || card.color_identity.every((color) => commanderColors.includes(color));
  const formatLegal = !card.legalities?.commander || ["legal", "restricted"].includes(card.legalities.commander);
  if (duplicate) return { score: 4, verdict: "Already included", tone: "bad", reasons: ["This card is already in the deck, and Commander remains stubbornly singleton."], cautions: [], roles, legal: false };
  if (!colorLegal || !formatLegal) {
    if (!colorLegal) cautions.push(`Its ${card.color_identity.join("") || "colorless"} identity falls outside the commander's colors.`);
    if (!formatLegal) cautions.push(`Scryfall currently lists it as ${card.legalities?.commander?.replace("_", " ")} in Commander.`);
    return { score: 0, verdict: "Not legal here", tone: "bad", reasons: [], cautions, roles, legal: false };
  }

  let score = 43;
  const needed = roles.filter((role) => roleTargets[role] && (counts[role] ?? 0) < roleTargets[role]);
  if (needed.length) {
    score += Math.min(20, needed.reduce((sum, role) => sum + Math.min(8, roleTargets[role] - (counts[role] ?? 0)), 0));
    reasons.push(`Fills thin roles: ${needed.map((role) => `${role} ${counts[role] ?? 0}/${roleTargets[role]}`).join(", ")}.`);
  }
  const synergy = commanderSynergy(card, commanders, strategy);
  score += synergy.score;
  if (synergy.matches.length) reasons.push(`Connects to the commander/plan through ${synergy.matches.slice(0, 4).join(", ")}.`);
  else if (commanders.length) cautions.push("It has little obvious rules-text overlap with the commander or stated plan.");

  const usefulRoles = roles.filter((role) => !["Creature", "Land"].includes(role));
  if (usefulRoles.length >= 2) { score += 6; reasons.push(`Does multiple jobs: ${usefulRoles.slice(0, 3).join(" and ")}.`); }
  if (!usefulRoles.length && !roles.includes("Land")) { score -= 7; cautions.push("Our role scan sees a body or effect, but no essential deck-maintenance job."); }
  const nonlands = deck.filter((item) => !isLandCard(item.card));
  const average = nonlands.reduce((sum, item) => sum + item.card.cmc * item.quantity, 0) / Math.max(1, nonlands.reduce((sum, item) => sum + item.quantity, 0));
  if (!roles.includes("Land") && card.cmc > average + 2) { score -= 9; cautions.push(`At mana value ${card.cmc}, it sits well above the current ${average.toFixed(2)} average.`); }
  else if (!roles.includes("Land") && card.cmc <= average) { score += 4; reasons.push(`Its mana value ${card.cmc} fits beneath the deck's ${average.toFixed(2)} average.`); }
  if (power !== null && power <= 2 && roles.includes("Tutor")) { score -= 5; cautions.push("A broad tutor may be sharper than the selected low-bracket experience."); }
  if (power !== null && power >= 4 && roles.includes("Tutor")) { score += 5; reasons.push("Tutoring improves the consistency expected at this target bracket."); }
  if (card.game_changer) {
    score += 6;
    reasons.push("Scryfall currently flags it as a Game Changer: a powerful card and a strong default keep once added.");
    if (power !== null && power < 3) cautions.push("A Game Changer raises the deck to at least bracket 3 under the current Commander bracket rules.");
  }
  if (!commanders.length) cautions.push("No commander is marked yet, so color and commander-synergy judgment is incomplete.");
  score = Math.max(0, Math.min(99, Math.round(score)));
  const verdict = score >= 85 ? "Excellent fit" : score >= 72 ? "Strong upgrade" : score >= 59 ? "Worth testing" : score >= 45 ? "Sidegrade" : score >= 25 ? "Fringe fit" : "Leave it in the binder";
  const tone = score >= 72 ? "good" : score >= 45 ? "mixed" : "bad";
  if (!reasons.length) reasons.push("It is legal and castable, but its case rests mostly on raw card quality.");
  return { score, verdict, tone, reasons, cautions, roles, legal: true };
}

function cutPriority(entry: DeckCard, deck: DeckCard[], strategy: string, commanderPopularity?: Map<string, EdhrecIdea>) {
  if (entry.locked || entry.commander || isLandCard(entry.card)) return -999;
  const roles = classify(entry.card);
  const counts = countRoles(deck);
  const commanders = deck.filter((item) => item.commander);
  const synergy = commanderSynergy(entry.card, commanders, strategy).score;
  const nonlands = deck.filter((item) => !isLandCard(item.card));
  const average = nonlands.reduce((sum, item) => sum + item.card.cmc * item.quantity, 0) / Math.max(1, nonlands.reduce((sum, item) => sum + item.quantity, 0));
  let score = 38 - synergy * .7;
  const useful = roles.filter((role) => !["Creature", "Land"].includes(role));
  if (!useful.length && !roles.includes("Land")) score += 12;
  if (useful.length >= 2) score -= 7;
  for (const role of roles) {
    const target = roleTargets[role];
    if (!target) continue;
    if ((counts[role] ?? 0) < target) score -= 12;
    else if ((counts[role] ?? 0) > target + 2) score += 5;
  }
  if (!roles.includes("Land") && entry.card.cmc > average + 1.5) score += Math.min(12, (entry.card.cmc - average) * 3);
  const rank = entry.card.edhrec_rank;
  if (typeof rank === "number") {
    if (rank <= 500) score -= 8;
    else if (rank <= 2500) score -= 4;
    else if (rank >= 15000) score += 5;
    else if (rank >= 8000) score += 2;
  }
  const commanderIdea = commanderPopularity?.get(entry.card.oracle_id ?? entry.card.id);
  if (commanderIdea) {
    if (typeof commanderIdea.inclusion === "number" && commanderIdea.inclusion >= .5) score -= 8;
    if (typeof commanderIdea.synergy === "number" && commanderIdea.synergy >= .4) score -= 6;
  }
  if (entry.card.game_changer) score -= GAME_CHANGER_KEEP_BONUS;
  return score;
}

type SwapOption = { cut: DeckCard; score: number; label: string; gained: string[]; lost: string[]; reasons: string[]; manaDelta: number };
type CurrentCardAnalysis = { pressure: number; label: string; tone: string; reasons: string[] };

function swapOptions(candidate: DeckCard, deck: DeckCard[], strategy: string, commanderPopularity?: Map<string, EdhrecIdea>) {
  const candidateRoles = classify(candidate.card).filter((role) => role !== "Creature");
  const candidateSynergy = commanderSynergy(candidate.card, deck.filter((item) => item.commander), strategy).score;
  return deck.filter((entry) => !entry.locked && !entry.commander && !isLandCard(entry.card)).map((cut): SwapOption => {
    const cutRoles = classify(cut.card).filter((role) => role !== "Creature");
    const overlap = candidateRoles.filter((role) => cutRoles.includes(role));
    const gained = candidateRoles.filter((role) => !cutRoles.includes(role));
    const lost = cutRoles.filter((role) => !candidateRoles.includes(role));
    const cutSynergy = commanderSynergy(cut.card, deck.filter((item) => item.commander), strategy).score;
    const manaDelta = candidate.card.cmc - cut.card.cmc;
    let score = cutPriority(cut, deck, strategy, commanderPopularity) + 28 + overlap.length * 6 + (candidateSynergy - cutSynergy) * .7;
    if (manaDelta < 0) score += Math.min(7, Math.abs(manaDelta) * 2);
    const reasons: string[] = [];
    if (overlap.length) reasons.push(`Preserves ${overlap.slice(0, 2).join(" and ")}.`);
    if (candidateSynergy > cutSynergy + 3) reasons.push("The proposed card has stronger commander/strategy overlap.");
    if (manaDelta < 0) reasons.push(`Lowers the slot by ${Math.abs(manaDelta)} mana.`);
    if (gained.length) reasons.push(`Adds ${gained.slice(0, 2).join(" and ")}.`);
    if (lost.length) reasons.push(`Watch the loss of ${lost.slice(0, 2).join(" and ")}.`);
    if (!reasons.length) reasons.push("This is a relatively low-synergy slot with no protected status.");
    score = Math.max(1, Math.min(99, Math.round(score)));
    const label = score >= 80 ? "Clean upgrade" : score >= 65 ? "Strong swap" : score >= 50 ? "Reasonable trade" : "Possible, with a cost";
    return { cut, score, label, gained, lost, reasons, manaDelta };
  }).sort((a, b) => b.score - a.score).slice(0, 6);
}

function analyzeCurrentCard(entry: DeckCard, deck: DeckCard[], strategy: string, commanderPopularity?: Map<string, EdhrecIdea>): CurrentCardAnalysis {
  if (entry.commander) return { pressure: 0, label: "Commander · core", tone: "good", reasons: ["The deck is built around this card, which is generally considered a persuasive keep argument."] };
  if (entry.locked) return { pressure: 0, label: "Protected", tone: "good", reasons: ["You protected this card from automatic cut suggestions."] };
  if (isLandCard(entry.card)) return { pressure: 0, label: "Mana base · protected", tone: "good", reasons: ["Lands are excluded from automatic cut suggestions. Mana bases deserve deliberate edits, not drive-by algorithmic vandalism."] };
  const pressure = Math.max(1, Math.min(99, Math.round(cutPriority(entry, deck, strategy, commanderPopularity))));
  const roles = classify(entry.card);
  const counts = countRoles(deck);
  const reasons: string[] = [];
  if (entry.card.game_changer) reasons.push("Scryfall currently marks this as a Game Changer. Its power makes it a strong default keep; cut it only when it actively fights the deck's plan or desired bracket.");
  const synergy = commanderSynergy(entry.card, deck.filter((item) => item.commander), strategy);
  if (synergy.matches.length) reasons.push(`Supports ${synergy.matches.slice(0, 4).join(", ")}.`);
  else reasons.push("Shows little direct overlap with the commander or stated strategy.");
  const needed = roles.filter((role) => roleTargets[role] && (counts[role] ?? 0) < roleTargets[role]);
  if (needed.length) reasons.push(`Protected by scarce roles: ${needed.join(", ")}.`);
  const useful = roles.filter((role) => !["Creature", "Land"].includes(role));
  if (useful.length >= 2) reasons.push(`Multi-role card covering ${useful.slice(0, 3).join(", ")}.`);
  if (!useful.length && !roles.includes("Land")) reasons.push("Our scan sees no ramp, draw, interaction, protection, recursion, or finishing role.");
  if (typeof entry.card.edhrec_rank === "number") reasons.push(`Overall EDHREC popularity rank: #${entry.card.edhrec_rank.toLocaleString()}. It is supporting evidence, not a royal decree.`);
  const commanderIdea = commanderPopularity?.get(entry.card.oracle_id ?? entry.card.id);
  if (typeof commanderIdea?.inclusion === "number") reasons.push(`Seen in ${Math.round(commanderIdea.inclusion * 100)}% of the commander decks represented on EDHREC.`);
  const label = pressure >= 65 ? "Cut first" : pressure >= 52 ? "Cut candidate" : pressure >= 38 ? "Flexible slot" : pressure >= 22 ? "Likely keep" : "Strong keep";
  const tone = pressure >= 52 ? "bad" : pressure >= 38 ? "mixed" : "good";
  return { pressure, label, tone, reasons };
}

async function fetchCollection(identifiers: Array<Record<string, string>>) {
  const cards: ScryfallCard[] = [];
  for (let index = 0; index < identifiers.length; index += 75) {
    const batch = identifiers.slice(index, index + 75);
    const response = await fetch("/api/scryfall", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: batch }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Scryfall declined the card summons.");
    cards.push(...(payload.data ?? []));
    if (index + 75 < identifiers.length) await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return cards;
}

async function hydrateEntries(entries: ParsedEntry[]): Promise<{ cards: DeckCard[]; missing: string[]; fallbackPrints: string[] }> {
  const identifierFor = (entry: ParsedEntry): Record<string, string> => entry.scryfallId
    ? { id: entry.scryfallId }
    : entry.set && entry.collectorNumber
      ? { set: entry.set, collector_number: entry.collectorNumber }
      : { name: entry.name };
  const unique = [...new Map(entries.map((entry) => {
    const identifier = identifierFor(entry);
    return [JSON.stringify(identifier), identifier];
  })).values()];
  const cards = await fetchCollection(unique);
  const byId = new Map<string, ScryfallCard>();
  const byPrint = new Map<string, ScryfallCard>();
  const byName = new Map<string, ScryfallCard>();
  const indexCards = (items: ScryfallCard[]) => items.forEach((card) => {
    byId.set(card.id, card);
    if (card.set && card.collector_number) byPrint.set(`${card.set.toLowerCase()}:${card.collector_number}`, card);
    byName.set(normalizeName(card.name), card);
    for (const face of card.card_faces ?? []) byName.set(normalizeName(face.name), card);
  });
  indexCards(cards);

  const resolveExact = (entry: ParsedEntry) => entry.scryfallId
    ? byId.get(entry.scryfallId)
    : entry.set && entry.collectorNumber
      ? byPrint.get(`${entry.set.toLowerCase()}:${entry.collectorNumber}`)
      : byName.get(normalizeName(entry.name));
  const unresolvedExact = entries.filter((entry) => !resolveExact(entry) && Boolean(entry.scryfallId || (entry.set && entry.collectorNumber)));
  const fallbackNames = [...new Set(unresolvedExact.map((entry) => entry.name))];
  if (fallbackNames.length) indexCards(await fetchCollection(fallbackNames.map((name) => ({ name }))));

  const missing: string[] = [];
  const fallbackPrints: string[] = [];
  const hydrated = entries.flatMap<DeckCard>((entry, index) => {
    let card = resolveExact(entry);
    if (!card && (entry.scryfallId || (entry.set && entry.collectorNumber))) {
      card = byName.get(normalizeName(entry.name));
      if (card) fallbackPrints.push(entry.name);
    }
    if (!card) card = byName.get(normalizeName(entry.name));
    if (!card) { missing.push(entry.name); return []; }
    const zone = normalizeHydratedZone(entry, card);
    const commander = zone === "commander";
    return [{
      recordId: `${card.id}:${zone}:${index}`,
      card,
      quantity: entry.quantity,
      commander,
      locked: commander,
      section: entry.section,
      groupLabels: entry.groupLabels ?? (entry.section ? [entry.section] : []),
      zoneSource: entry.zoneSource,
      zone,
    }];
  });

  return {
    cards: hydrated,
    missing: [...new Set(missing)],
    fallbackPrints: [...new Set(fallbackPrints)],
  };
}

function CardTile({ entry, selected, onSelect, onPreview, badge }: { entry: DeckCard; selected: boolean; onSelect: () => void; onPreview: (card: ScryfallCard) => void; badge?: string }) {
  const roles = classify(entry.card).filter((role) => role !== "Creature").slice(0, 2);
  const image = imageFor(entry.card, "small");
  return (
    <button className={`card-tile ${selected ? "is-selected" : ""}`} onClick={onSelect} onDoubleClick={() => onPreview(entry.card)} type="button" aria-label={`Inspect ${entry.card.name}. Double-click to expand.`} title="Click to inspect · double-click to expand">
      <div className="card-art-wrap">
        {image ? <img src={image} alt={entry.card.name} className="card-art" loading="lazy" /> : <div className="card-art-fallback">{entry.card.name}</div>}
        {entry.quantity > 1 && <span className="quantity-badge">×{entry.quantity}</span>}
        {entry.commander && <span className="commander-badge">Commander</span>}
        {entry.card.game_changer && <span className="game-changer-badge">Game Changer</span>}
        {entry.locked && !entry.commander && <span className="lock-badge" aria-label="Locked">◆</span>}
      </div>
      <span className="card-tile-name">{entry.card.name}</span>
      <span className="card-tile-meta">{badge ?? (roles.join(" · ") || entry.card.type_line.split("—")[0].trim())}</span>
      <span className="card-tile-print">{printingLabel(entry.card)}</span>
    </button>
  );
}

function CardPreviewDialog({ card, onClose }: { card: ScryfallCard; onClose: () => void }) {
  const [previewFace, setPreviewFace] = useState(0);
  const face = card.card_faces?.[previewFace];
  const image = faceImage(card, previewFace);
  const rulesText = (face?.oracle_text ?? card.oracle_text ?? oracleText(card)) || "No rules text.";
  const typeLine = face?.type_line ?? card.type_line;
  const manaCost = face?.mana_cost ?? card.mana_cost;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return <div className="card-preview-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="card-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="card-preview-title">
      <button className="card-preview-close" onClick={onClose} type="button" aria-label="Close card preview" autoFocus>×</button>
      <div className="card-preview-art-column">
        {image ? <img src={image} alt={face?.name ?? card.name} className="card-preview-art" /> : <div className="card-art-fallback large">{card.name}</div>}
        {card.card_faces && card.card_faces.length > 1 && <button className="button ghost card-preview-flip" onClick={() => setPreviewFace((current) => (current + 1) % card.card_faces!.length)} type="button">↻ Show {card.card_faces[(previewFace + 1) % card.card_faces.length].name}</button>}
      </div>
      <div className="card-preview-details">
        <span className="eyebrow">Exact card preview</span>
        <h2 id="card-preview-title">{face?.name ?? card.name}</h2>
        {card.game_changer && <div className="game-changer-callout">Game Changer · strong default keep</div>}
        <p className="card-preview-type">{manaCost ? `${manaCost} · ` : ""}{typeLine}</p>
        <div className="role-chips">{classify(card).map((role) => <span key={role}>{role}</span>)}</div>
        <div className="card-preview-rules">{rulesText}</div>
        <dl className="card-preview-facts">
          <div><dt>Exact printing</dt><dd>{printingLabel(card)}</dd></div>
          <div><dt>Set</dt><dd>{card.set_name ?? card.set?.toUpperCase() ?? "Unknown"}</dd></div>
          <div><dt>Mana value</dt><dd>{card.cmc}</dd></div>
          <div><dt>Colors</dt><dd>{card.color_identity.join("") || "Colorless"}</dd></div>
          <div><dt>Commander</dt><dd>{card.legalities?.commander?.replace("_", " ") ?? "Unknown"}</dd></div>
          <div><dt>EDHREC rank</dt><dd>{card.edhrec_rank ? `#${card.edhrec_rank.toLocaleString()}` : "Unranked"}</dd></div>
          <div><dt>USD</dt><dd>{card.prices?.usd ? `$${card.prices.usd}` : "—"}</dd></div>
        </dl>
        {card.scryfall_uri && <a className="card-source-link" href={card.scryfall_uri} target="_blank" rel="noreferrer">Open this exact printing on Scryfall ↗</a>}
      </div>
    </section>
  </div>;
}

type DesktopApiStatus = {
  configured: boolean;
  encryptionAvailable: boolean;
  storage: string;
  appVersion: string;
};

function DesktopSettingsDialog({ status, busy, error, onSave, onClear, onClose }: {
  status: DesktopApiStatus | null;
  busy: boolean;
  error: string;
  onSave: (apiKey: string) => Promise<boolean>;
  onClear: () => Promise<void>;
  onClose: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return <div className="desktop-settings-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="desktop-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="desktop-settings-title">
      <button className="card-preview-close" onClick={onClose} type="button" aria-label="Close desktop settings" autoFocus>×</button>
      <div className="desktop-settings-heading">
        <img src="/sbs-mark.svg" alt="" />
        <div><span className="eyebrow">Windows desktop</span><h2 id="desktop-settings-title">Settings</h2></div>
      </div>
      <div className={`desktop-key-status ${status?.configured ? "configured" : ""}`}>
        <i />
        <div><strong>{status?.configured ? "AI advisor connected" : "AI advisor not connected"}</strong><span>{status ? `${status.storage} · App ${status.appVersion}` : "Checking secure storage…"}</span></div>
      </div>
      <p>The deck editor, Scryfall data, EDHREC suggestions, and swap rankings work without an API key. Add your own OpenAI API key only if you want the optional model-written deck review.</p>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (await onSave(apiKey)) setApiKey("");
      }}>
        <label htmlFor="desktop-openai-key">OpenAI API key</label>
        <div className="desktop-key-row"><input id="desktop-openai-key" type={reveal ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder={status?.configured ? "Enter a new key to replace the saved one" : "sk-…"} /><button className="button ghost" onClick={() => setReveal((visible) => !visible)} type="button">{reveal ? "Hide" : "Show"}</button></div>
        <small>Encrypted for your Windows user account. Never saved in browser storage or included in deck exports. API billing is separate from ChatGPT.</small>
        {error && <div className="desktop-settings-error">{error}</div>}
        <div className="desktop-settings-actions">
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Get or manage API keys ↗</a>
          <div>{status?.configured && <button className="button ghost" onClick={() => void onClear()} disabled={busy} type="button">Remove saved key</button>}<button className="button primary" disabled={busy || apiKey.trim().length < 20 || status?.encryptionAvailable === false} type="submit">{busy ? "Saving securely…" : status?.configured ? "Replace key" : "Save key"}</button></div>
        </div>
      </form>
    </section>
  </div>;
}

const zoneLabels: Record<DeckZone, string> = {
  commander: "Commander",
  main: "Main deck",
  maybeboard: "Maybeboard / proposals",
  sideboard: "Sideboard",
  companion: "Companion",
  token: "Tokens / emblems",
};

function restoreDeckCard(entry: DeckCard, index: number, forcedZone?: DeckZone): DeckCard {
  const originalZone = forcedZone ?? entry.zone ?? (entry.commander ? "commander" : "main");
  const zone = normalizeHydratedZone({ zone: originalZone, zoneSource: entry.zoneSource }, entry.card);
  const commander = zone === "commander";
  return {
    ...entry,
    recordId: entry.recordId ?? `${entry.card.id}:${zone}:restored-${index}`,
    groupLabels: entry.groupLabels ?? (entry.section ? [entry.section] : []),
    zone,
    commander,
    locked: commander || Boolean(entry.locked),
  };
}

export default function Home() {
  const [view, setView] = useState<View>("deck");
  const [workspaceEntries, setWorkspaceEntries] = useState<DeckCard[]>([]);
  const [candidates, setCandidates] = useState<DeckCard[]>([]);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [deckName, setDeckName] = useState("Untitled Commander Deck");
  const [strategy, setStrategy] = useState("Synergy-forward casual Commander");
  const [power, setPower] = useState<number | null>(null);
  const [bracketSource, setBracketSource] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [candidateText, setCandidateText] = useState("");
  const [deckUrl, setDeckUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [deckSort, setDeckSort] = useState<"type" | "curve" | "cuts" | "name">("type");
  const [sessionReady, setSessionReady] = useState(false);
  const [history, setHistory] = useState<Array<{ entries: DeckCard[]; candidates: DeckCard[] }>>([]);
  const [faceIndex, setFaceIndex] = useState(0);
  const [edhrecIdeas, setEdhrecIdeas] = useState<EdhrecIdea[]>([]);
  const [edhrecSource, setEdhrecSource] = useState<string | null>(null);
  const [edhrecBusy, setEdhrecBusy] = useState(false);
  const [edhrecError, setEdhrecError] = useState("");
  const [suggestionRefresh, setSuggestionRefresh] = useState(0);
  const [previewCutId, setPreviewCutId] = useState<string | null>(null);
  const [aiAdvisorOpen, setAiAdvisorOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiReview, setAiReview] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [desktopMode, setDesktopMode] = useState(false);
  const [desktopSettingsOpen, setDesktopSettingsOpen] = useState(false);
  const [desktopApiStatus, setDesktopApiStatus] = useState<DesktopApiStatus | null>(null);
  const [desktopSettingsBusy, setDesktopSettingsBusy] = useState(false);
  const [desktopSettingsError, setDesktopSettingsError] = useState("");
  const [inspectedCard, setInspectedCard] = useState<ScryfallCard | null>(null);
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);

  const deck = useMemo(() => workspaceEntries.filter((entry) => isCountedZone(entry.zone)), [workspaceEntries]);
  const extras = useMemo(() => workspaceEntries.filter((entry) => !isCountedZone(entry.zone)), [workspaceEntries]);
  const sideboardCandidates = useMemo(() => extras.filter((entry) => entry.zone === "sideboard"), [extras]);
  const evaluationCandidates = useMemo(() => [...candidates, ...sideboardCandidates], [candidates, sideboardCandidates]);
  const selected = [...workspaceEntries, ...candidates].find((entry) => entry.recordId === selectedId || entry.card.id === selectedId) ?? null;
  const inspectorCard = inspectedCard ?? selected?.card ?? null;
  const inspectorEntry = selected?.card.id === inspectorCard?.id ? selected : null;
  const pendingCounts = useMemo(() => pendingImport ? countEntries(pendingImport.entries) : null, [pendingImport]);
  const stats = useMemo(() => {
    const total = deck.reduce((sum, entry) => sum + entry.quantity, 0);
    const lands = deck.filter((entry) => isLandCard(entry.card)).reduce((sum, entry) => sum + entry.quantity, 0);
    const nonlands = deck.filter((entry) => !isLandCard(entry.card));
    const nonlandCount = nonlands.reduce((sum, entry) => sum + entry.quantity, 0);
    const average = nonlands.reduce((sum, entry) => sum + entry.card.cmc * entry.quantity, 0) / Math.max(1, nonlandCount);
    const roles = deck.flatMap((entry) => Array(entry.quantity).fill(classify(entry.card)).flat());
    const count = (role: string) => roles.filter((item) => item === role).length;
    const gameChangers = deck.filter((entry) => entry.card.game_changer).reduce((sum, entry) => sum + entry.quantity, 0);
    const commanders = deck.filter((entry) => entry.commander).reduce((sum, entry) => sum + entry.quantity, 0);
    const extraCount = extras.reduce((sum, entry) => sum + entry.quantity, 0);
    return { total, commanders, lands, average, ramp: count("Ramp"), draw: count("Draw"), interaction: count("Interaction"), wipes: count("Board wipe"), gameChangers, extraCount };
  }, [deck, extras]);

  const bracketFloor = stats.gameChangers > 3 ? 4 : stats.gameChangers > 0 ? 3 : null;

  const commanderPopularity = useMemo(() => new Map(edhrecIdeas.map((idea) => [idea.entry.card.oracle_id ?? idea.entry.card.id, idea])), [edhrecIdeas]);
  const candidateAnalyses = useMemo(() => new Map(evaluationCandidates.map((entry) => [entry.card.id, analyzeCandidate(entry, deck, strategy, power)])), [evaluationCandidates, deck, strategy, power]);
  const currentAnalyses = useMemo(() => new Map(deck.map((entry) => [entry.card.id, analyzeCurrentCard(entry, deck, strategy, commanderPopularity)])), [deck, strategy, commanderPopularity]);
  const rankedDeck = useMemo(() => [...deck].sort((a, b) => {
    if (Number(b.commander) !== Number(a.commander)) return Number(b.commander) - Number(a.commander);
    if (deckSort === "cuts") return (currentAnalyses.get(b.card.id)?.pressure ?? 0) - (currentAnalyses.get(a.card.id)?.pressure ?? 0);
    if (deckSort === "name") return a.card.name.localeCompare(b.card.name);
    if (deckSort === "type") {
      const typeDelta = typeOrder.indexOf(primaryType(a.card, a.commander)) - typeOrder.indexOf(primaryType(b.card, b.commander));
      return typeDelta || a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name);
    }
    return a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name);
  }), [deck, deckSort, currentAnalyses]);
  const groupedDeck = useMemo(() => typeOrder.map((type) => ({
    type,
    cards: rankedDeck.filter((entry) => primaryType(entry.card, entry.commander) === type),
  })).filter((group) => group.cards.length), [rankedDeck]);
  const activeCandidate = evaluationCandidates.find((entry) => entry.recordId === selectedId || entry.card.id === selectedId) ?? evaluationCandidates[0] ?? null;
  const activeAnalysis = activeCandidate ? candidateAnalyses.get(activeCandidate.card.id) ?? null : null;
  const activeSwaps = useMemo(() => activeCandidate && activeAnalysis?.legal ? swapOptions(activeCandidate, deck, strategy, commanderPopularity) : [], [activeCandidate, activeAnalysis, deck, strategy, commanderPopularity]);
  const previewSwap = activeSwaps.find((option) => option.cut.recordId === previewCutId) ?? activeSwaps[0] ?? null;
  const commanderKey = deck.filter((entry) => entry.commander).map((entry) => entry.card.name).sort().join("|");
  const visibleEdhrecIdeas = useMemo(() => {
    const present = new Set([...deck, ...evaluationCandidates].map((entry) => entry.card.oracle_id ?? entry.card.id));
    return edhrecIdeas.filter((idea) => !present.has(idea.entry.card.oracle_id ?? idea.entry.card.id)).slice(0, 12);
  }, [edhrecIdeas, deck, evaluationCandidates]);

  useEffect(() => {
    const desktop = window.sbsDesktop;
    if (!desktop?.isDesktop) return;
    let active = true;
    desktop.getApiKeyStatus().then((status) => {
      if (!active) return;
      setDesktopMode(true);
      setDesktopApiStatus(status);
      setAiAvailable(status.configured);
    }).catch((error) => {
      if (!active) return;
      setDesktopMode(true);
      setDesktopSettingsError(error instanceof Error ? error.message : "Desktop settings could not be loaded.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const savedV3 = localStorage.getItem("sbs-mtg-deck-editor-session-v3");
        const savedV2 = localStorage.getItem("sbs-mtg-deck-editor-session-v2");
        const raw = savedV3 ?? savedV2;
        if (raw) {
          const session = JSON.parse(raw) as { entries?: DeckCard[]; deck?: DeckCard[]; candidates?: DeckCard[]; extras?: DeckCard[]; deckName?: string; strategy?: string; power?: number | null; bracketSource?: string | null };
          const legacyEntries = [...(session.deck ?? []), ...(session.extras ?? [])];
          const restoredEntries = (session.entries ?? legacyEntries).map((entry, index) => restoreDeckCard(entry, index));
          const restoredCandidates = (session.candidates ?? []).map((entry, index) => restoreDeckCard(entry, index, "maybeboard"));
          if (restoredEntries.some((entry) => isCountedZone(entry.zone))) {
            setWorkspaceEntries(restoredEntries);
            setCandidates(restoredCandidates);
            setDeckName(session.deckName ?? "Saved Commander Deck");
            setStrategy(session.strategy ?? "Synergy-forward casual Commander"); setPower(session.power ?? null); setBracketSource(session.bracketSource ?? null);
            const first = restoredEntries.find((entry) => entry.commander) ?? restoredEntries.find((entry) => isCountedZone(entry.zone));
            setSelectedId(first?.recordId ?? null);
            setInspectedCard(first?.card ?? null);
            setNotice(savedV3 ? "Restored your last local workshop session." : "Migrated your saved workshop into the new zone-safe deck model.");
          }
        }
      } catch {
        localStorage.removeItem("sbs-mtg-deck-editor-session-v2");
        localStorage.removeItem("sbs-mtg-deck-editor-session-v3");
      }
      setSessionReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!sessionReady || !deck.length) return;
    localStorage.setItem("sbs-mtg-deck-editor-session-v3", JSON.stringify({ entries: workspaceEntries, candidates, deckName, strategy, power, bracketSource }));
  }, [sessionReady, deck.length, workspaceEntries, candidates, deckName, strategy, power, bracketSource]);

  useEffect(() => {
    if (!commanderKey) return;
    const controller = new AbortController();
    const loadIdeas = async () => {
      setEdhrecBusy(true);
      setEdhrecError("");
      try {
        const params = new URLSearchParams();
        commanderKey.split("|").forEach((name) => params.append("commander", name));
        const response = await fetch(`/api/edhrec?${params}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "EDHREC suggestions are unavailable.");
        const rawIdeas = (payload.suggestions ?? []).slice(0, 24) as Array<Omit<EdhrecIdea, "entry"> & { name: string }>;
        const hydrated = await hydrateEntries(rawIdeas.map((idea) => ({ name: idea.name, quantity: 1, zone: "maybeboard", section: "EDHREC", groupLabels: ["EDHREC"], zoneSource: "explicit" })));
        setEdhrecIdeas(hydrated.cards.flatMap<EdhrecIdea>((entry) => {
          const names = [entry.card.name, ...(entry.card.card_faces ?? []).map((face) => face.name)].map(normalizeName);
          const idea = rawIdeas.find((item) => names.includes(normalizeName(item.name)));
          if (!idea) return [];
          return [{ entry: { ...entry, commander: false, locked: false, zone: "maybeboard" }, tag: idea.tag, label: idea.label, synergy: idea.synergy, inclusion: idea.inclusion, numDecks: idea.numDecks, potentialDecks: idea.potentialDecks }];
        }));
        setEdhrecSource(payload.source ?? null);
        if (!hydrated.cards.length) setEdhrecError("EDHREC returned ideas, but none could be matched to current Scryfall cards. Try refreshing in a moment.");
      } catch (error) {
        if (!controller.signal.aborted) {
          setEdhrecIdeas([]);
          setEdhrecSource(null);
          setEdhrecError(error instanceof Error ? error.message : "EDHREC suggestions are unavailable right now.");
        }
      } finally {
        if (!controller.signal.aborted) setEdhrecBusy(false);
      }
    };
    void loadIdeas();
    return () => controller.abort();
  }, [commanderKey, suggestionRefresh]);

  useEffect(() => {
    if (search.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/scryfall?autocomplete=${encodeURIComponent(search.trim())}`, { signal: controller.signal });
        const payload = await response.json();
        setSuggestions((payload.data ?? []).slice(0, 7));
      } catch { if (!controller.signal.aborted) setSuggestions([]); }
    }, 240);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(() => setFaceIndex(0), 0);
    return () => window.clearTimeout(timer);
  }, [inspectorCard?.id]);

  useEffect(() => {
    if (!aiAdvisorOpen) return;
    const controller = new AbortController();
    fetch("/api/ai-review", { signal: controller.signal })
      .then((response) => response.json())
      .then((payload) => setAiAvailable(payload.available === true))
      .catch(() => { if (!controller.signal.aborted) setAiAvailable(false); });
    return () => controller.abort();
  }, [aiAdvisorOpen]);

  async function importDeck(source: "text" | "url" | "demo") {
    setBusy(true); setNotice("");
    try {
      let entries: ParsedEntry[] = [];
      let importedName = source === "demo" ? "Cats & Dogs, Living Together" : "Imported Commander Deck";
      let importedBracket: number | null = null;
      let importedBracketSource: string | null = null;
      if (source === "url") {
        const provider = /moxfield\.com/i.test(deckUrl) ? "moxfield" : /archidekt\.com/i.test(deckUrl) ? "archidekt" : null;
        if (!provider) throw new Error("Use a public Archidekt or Moxfield deck link, or paste an exported list below.");
        const response = await fetch(`/api/${provider}?url=${encodeURIComponent(deckUrl)}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "That deck link resisted arrest.");
        entries = [...(payload.entries ?? []), ...(payload.candidates ?? []), ...(payload.extras ?? [])];
        importedName = payload.name ?? `Imported ${provider === "moxfield" ? "Moxfield" : "Archidekt"} Deck`;
        importedBracket = typeof payload.bracket === "number" && payload.bracket >= 1 && payload.bracket <= 5 ? payload.bracket : null;
        importedBracketSource = importedBracket ? (provider === "moxfield" ? "Moxfield" : "Archidekt") : null;
      } else {
        const parsed = parseDeckText(source === "demo" ? demoDeck : importText);
        entries = parsed.entries;
      }
      if (!entries.length) throw new Error("I couldn't find any card lines. Try “1 Sol Ring” formatting.");
      const hydrated = await hydrateEntries(entries);
      const counts = countEntries(hydrated.cards);
      if (!counts.deckTotal) throw new Error("The source was readable, but every card landed outside the commander/main zones. Review its exported headings and try again.");
      const warnings: string[] = [];
      if (hydrated.missing.length) warnings.push(`Couldn’t identify: ${hydrated.missing.join(", ")}.`);
      if (hydrated.fallbackPrints.length) warnings.push(`Exact printing unavailable for ${hydrated.fallbackPrints.join(", ")}; used Scryfall’s current printing.`);
      setPendingImport({ name: importedName, entries: hydrated.cards, bracket: importedBracket, bracketSource: importedBracketSource, warnings });
    } catch (error) { setNotice(error instanceof Error ? error.message : "The import spell fizzled."); }
    finally { setBusy(false); }
  }

  function movePendingEntry(recordId: string, zone: DeckZone) {
    setPendingImport((current) => current ? {
      ...current,
      entries: current.entries.map((entry) => entry.recordId === recordId ? {
        ...entry,
        zone,
        zoneSource: "explicit",
        commander: zone === "commander",
        locked: zone === "commander" || (isCountedZone(zone) && entry.locked),
      } : entry),
    } : null);
  }

  function confirmPendingImport() {
    if (!pendingImport) return;
    const counts = countEntries(pendingImport.entries);
    if (!counts.deckTotal) { setNotice("Assign at least one card to Commander or Main deck before confirming."); return; }
    const proposals = pendingImport.entries
      .filter((entry) => entry.zone === "maybeboard")
      .map((entry) => ({ ...entry, commander: false, locked: false }));
    const workspace = pendingImport.entries.filter((entry) => entry.zone !== "maybeboard");
    const proposalTotal = proposals.reduce((sum, entry) => sum + entry.quantity, 0);
    const retainedOutside = counts.outsideTotal - proposalTotal;
    setWorkspaceEntries(workspace);
    setCandidates(proposals);
    setDeckName(pendingImport.name);
    setPower(pendingImport.bracket);
    setBracketSource(pendingImport.bracketSource);
    setHistory([]);
    const first = workspace.find((entry) => entry.commander) ?? workspace.find((entry) => isCountedZone(entry.zone));
    setSelectedId(first?.recordId ?? null);
    setInspectedCard(first?.card ?? null);
    setPendingImport(null);
    setView("deck");
    setNotice(`Imported ${counts.deckTotal} counted card${counts.deckTotal === 1 ? "" : "s"}. ${retainedOutside} sideboard/token/companion card${retainedOutside === 1 ? "" : "s"} stayed outside; ${proposalTotal} entered the proposal pool.`);
  }

  async function importCandidates() {
    setBusy(true); setNotice("");
    try {
      const parsed = parseDeckText(candidateText);
      const entries = parsed.entries.map((entry) => ({ ...entry, commander: false, zoneSource: "explicit" as const, zone: "maybeboard" as const }));
      if (!entries.length) throw new Error("Add at least one proposed card first.");
      const hydrated = await hydrateEntries(entries);
      setCandidates((current) => {
        const existing = new Set([...current, ...sideboardCandidates].map((entry) => entry.card.oracle_id ?? entry.card.id));
        return [...current, ...hydrated.cards.filter((entry) => !existing.has(entry.card.oracle_id ?? entry.card.id)).map((entry) => ({ ...entry, commander: false, locked: false, groupLabels: ["Proposed"], zoneSource: "explicit" as const, zone: "maybeboard" as const }))];
      });
      setCandidateText(""); setView("proposed"); setNotice(`Added ${hydrated.cards.length} cards to the proposal pool.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The proposed cards escaped containment."); }
    finally { setBusy(false); }
  }

  async function addSuggestion(name: string) {
    setSearch(""); setSuggestions([]); setBusy(true);
    try {
      const response = await fetch(`/api/scryfall?named=${encodeURIComponent(name)}`);
      const card = await response.json();
      if (!response.ok) throw new Error(card.details ?? card.error ?? "Card not found.");
      const key = card.oracle_id ?? card.id;
      if (evaluationCandidates.some((entry) => (entry.card.oracle_id ?? entry.card.id) === key)) {
        const existing = evaluationCandidates.find((entry) => (entry.card.oracle_id ?? entry.card.id) === key);
        setSelectedId(existing?.recordId ?? card.id); setInspectedCard(existing?.card ?? card); setView("proposed");
        setNotice(existing?.zone === "sideboard" ? `${card.name} is already in the sideboard and ready for evaluation.` : `${card.name} is already in the proposal pool.`);
      } else {
        const entry: DeckCard = { recordId: `${card.id}:proposal`, card, quantity: 1, commander: false, locked: false, section: "Proposed", groupLabels: ["Proposed"], zoneSource: "explicit", zone: "maybeboard" };
        setCandidates((current) => [...current, entry]);
        setSelectedId(entry.recordId); setInspectedCard(entry.card); setView("proposed"); setNotice(`${card.name} added for evaluation.`);
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : "Card search failed."); }
    finally { setBusy(false); }
  }

  function addEdhrecIdea(idea: EdhrecIdea) {
    const key = idea.entry.card.oracle_id ?? idea.entry.card.id;
    if ([...deck, ...evaluationCandidates].some((entry) => (entry.card.oracle_id ?? entry.card.id) === key)) return;
    const proposal = { ...idea.entry, recordId: `${idea.entry.card.id}:proposal`, commander: false, locked: false, zone: "maybeboard" as const, zoneSource: "explicit" as const, section: "EDHREC idea", groupLabels: ["EDHREC idea"] };
    setCandidates((current) => [...current, proposal]);
    setSelectedId(proposal.recordId); setInspectedCard(proposal.card); setView("proposed");
    setNotice(`${idea.entry.card.name} moved from EDHREC ideas into your proposal pool.`);
  }

  function toggleLock() {
    if (!selected) return;
    setWorkspaceEntries((current) => current.map((entry) => entry.recordId === selected.recordId ? { ...entry, locked: entry.commander ? true : !entry.locked } : entry));
  }
  function removeSelected() {
    if (!selected) return;
    if (candidates.some((entry) => entry.recordId === selected.recordId)) setCandidates((current) => current.filter((entry) => entry.recordId !== selected.recordId));
    else if (!selected.commander && !selected.locked) setWorkspaceEntries((current) => current.filter((entry) => entry.recordId !== selected.recordId));
    setSelectedId(null);
    setInspectedCard(null);
  }
  function resetSession() {
    setWorkspaceEntries([]); setCandidates([]); setPendingImport(null); setHistory([]); setSelectedId(null); setInspectedCard(null); setNotice(""); setImportText(""); setDeckUrl(""); setDeckName("Untitled Commander Deck"); setPower(null); setBracketSource(null); setView("deck");
    localStorage.removeItem("sbs-mtg-deck-editor-session-v1");
    localStorage.removeItem("sbs-mtg-deck-editor-session-v2");
    localStorage.removeItem("sbs-mtg-deck-editor-session-v3");
  }

  function snapshot() {
    setHistory((current) => [...current.slice(-9), { entries: workspaceEntries, candidates }]);
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setWorkspaceEntries(previous.entries); setCandidates(previous.candidates); setHistory((current) => current.slice(0, -1)); setSelectedId(null); setInspectedCard(null); setNotice("Undid the last deck change. Time magic: less banned than expected.");
  }

  function addToDeck(candidate: DeckCard, cut?: DeckCard) {
    const analysis = candidateAnalyses.get(candidate.card.id);
    if (!analysis?.legal) { setNotice(`${candidate.card.name} cannot be added to this Commander deck.`); return; }
    const cameFromSideboard = candidate.zone === "sideboard";
    const enteringRecordId = cameFromSideboard && candidate.quantity > 1 ? `${candidate.recordId}:main` : candidate.recordId;
    snapshot();
    setWorkspaceEntries((current) => applyConfirmedSwap(current, candidate, cut));
    setCandidates((current) => current.filter((entry) => entry.recordId !== candidate.recordId));
    setSelectedId(enteringRecordId); setInspectedCard(candidate.card); setView("swaps"); setPreviewCutId(null);
    setNotice(cut
      ? `${cameFromSideboard ? "Moved from sideboard: " : ""}${cut.card.name} → ${candidate.card.name}. Your exact-print export is ready below.`
      : `${cameFromSideboard ? "Moved" : "Added"} ${candidate.card.name}${cameFromSideboard ? " from sideboard" : ""} into an open slot. Your exact-print export is ready below.`);
  }

  function markCommander() {
    if (!selected || !deck.some((entry) => entry.recordId === selected.recordId)) return;
    snapshot();
    setWorkspaceEntries((current) => current.map((entry) => entry.recordId === selected.recordId ? { ...entry, commander: true, locked: true, section: "Commander", groupLabels: ["Commander"], zoneSource: "explicit", zone: "commander" } : entry));
    setNotice(`${selected.card.name} marked as a commander. Partners and Backgrounds can be marked too.`);
  }

  function decklistText(includeProposals = false) {
    const counted = countedDecklistText(workspaceEntries);
    const proposed = includeProposals && candidates.length ? `\n\nMaybeboard\n${[...candidates].sort((a, b) => a.card.name.localeCompare(b.card.name)).map(exactPrintLine).join("\n")}` : "";
    const extrasText = includeProposals ? (["sideboard", "companion", "token"] as DeckZone[]).map((zone) => {
      const cards = extras.filter((entry) => entry.zone === zone);
      if (!cards.length) return "";
      const title = zone === "token" ? "Tokens" : zone[0].toUpperCase() + zone.slice(1);
      return `\n\n${title}\n${cards.map(exactPrintLine).join("\n")}`;
    }).join("") : "";
    return `${counted}${proposed}${extrasText}`;
  }

  async function copyDecklist() {
    await navigator.clipboard.writeText(decklistText(true));
    setNotice("Copied the deck, exact set codes, proposal pool, and separate extra zones.");
  }

  async function copyUpdatedDecklist() {
    await navigator.clipboard.writeText(decklistText(false));
    setNotice("Copied the updated 100-card list with exact set codes for Archidekt or Moxfield.");
  }

  function exportDecklist() {
    const blob = new Blob([decklistText(true)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${deckName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "sbs-deck"}.txt`;
    anchor.click(); URL.revokeObjectURL(url); setNotice("Exported a set-aware text list for Archidekt, Moxfield, or future-you.");
  }

  function downloadUpdatedDecklist() {
    const blob = new Blob([decklistText(false)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${deckName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "sbs-deck"}-updated.txt`;
    anchor.click(); URL.revokeObjectURL(url); setNotice("Downloaded the updated exact-print decklist for Archidekt or Moxfield.");
  }

  async function saveDesktopApiKey(apiKey: string) {
    const desktop = window.sbsDesktop;
    if (!desktop) return false;
    setDesktopSettingsBusy(true);
    setDesktopSettingsError("");
    try {
      await desktop.saveOpenAiApiKey(apiKey);
      const status = await desktop.getApiKeyStatus();
      setDesktopApiStatus(status);
      setAiAvailable(status.configured);
      setAiError("");
      return status.configured;
    } catch (error) {
      setDesktopSettingsError(error instanceof Error ? error.message : "The API key could not be saved.");
      return false;
    } finally {
      setDesktopSettingsBusy(false);
    }
  }

  async function clearDesktopApiKey() {
    const desktop = window.sbsDesktop;
    if (!desktop) return;
    setDesktopSettingsBusy(true);
    setDesktopSettingsError("");
    try {
      await desktop.clearOpenAiApiKey();
      const status = await desktop.getApiKeyStatus();
      setDesktopApiStatus(status);
      setAiAvailable(false);
      setAiReview("");
    } catch (error) {
      setDesktopSettingsError(error instanceof Error ? error.message : "The saved API key could not be removed.");
    } finally {
      setDesktopSettingsBusy(false);
    }
  }

  async function runAiReview() {
    setAiBusy(true); setAiError(""); setAiReview("");
    try {
      const proposals = evaluationCandidates.map((entry) => {
        const analysis = candidateAnalyses.get(entry.card.id);
        const edhrec = commanderPopularity.get(entry.card.oracle_id ?? entry.card.id);
        return {
          card: `${entry.card.name} · ${printingLabel(entry.card)}`,
          source: entry.zone === "sideboard" ? "Imported sideboard" : "Proposed / maybeboard",
          fitScore: analysis?.score,
          verdict: analysis?.verdict,
          reasons: analysis?.reasons,
          cautions: analysis?.cautions,
          edhrecInclusion: edhrec?.inclusion,
          suggestedCuts: swapOptions(entry, deck, strategy, commanderPopularity).slice(0, 5).map((option) => ({
            card: option.cut.card.name,
            printing: printingLabel(option.cut.card),
            swapScore: option.score,
            gameChanger: Boolean(option.cut.card.game_changer),
            reasons: option.reasons,
            rolesGained: option.gained,
            rolesLost: option.lost,
          })),
        };
      });
      const response = await fetch("/api/ai-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deckName,
          strategy,
          selectedBracket: power,
          mainDeckCount: stats.total,
          lands: stats.lands,
          decklist: decklistText(false),
          protectedCards: deck.filter((entry) => entry.commander || entry.locked || isLandCard(entry.card)).map((entry) => entry.card.name),
          gameChangers: deck.filter((entry) => entry.card.game_changer).map((entry) => entry.card.name),
          proposals,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The optional AI advisor is unavailable.");
      setAiReview(payload.review ?? "The advisor returned an empty scroll. Rude.");
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "The optional AI advisor is unavailable.");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><img src="/sbs-mark.svg" alt="SaltyBananaSlug" className="brand-mark" /><div><span className="brand-kicker">SaltyBananaSlug&apos;s</span><h1>MTG Deck Editor</h1></div></div>
        <div className="topbar-actions">
          <span className={`live-pill ${desktopMode ? "desktop" : ""}`}><i /> {desktopMode ? "Windows desktop · card data live" : "Browser test build · Scryfall live"}</span>
          {desktopMode && <button className="button ghost" onClick={() => { setDesktopSettingsError(""); setDesktopSettingsOpen(true); }} type="button">Settings</button>}
          {deck.length > 0 && <>
            {history.length > 0 && <button className="button ghost" onClick={undo} type="button">Undo</button>}
            <button className="button ghost" onClick={() => setAiAdvisorOpen((open) => !open)} type="button">AI advisor</button>
            <button className="button ghost" onClick={copyDecklist} type="button">Copy list</button>
            <button className="button gold" onClick={exportDecklist} type="button">Export</button>
            <button className="button ghost" onClick={resetSession} type="button">New session</button>
          </>}
        </div>
      </header>

      {deck.length > 0 && aiAdvisorOpen && <section className="ai-advisor-panel">
        <div className="ai-advisor-heading"><div><span className="eyebrow">Optional second opinion</span><h2>AI deck advisor</h2></div><button className="text-button" onClick={() => setAiAdvisorOpen(false)} type="button">Close ×</button></div>
        <p>The built-in Scryfall/EDHREC ranking always works. A model-written review needs a user-provided OpenAI API key; signing into ChatGPT identifies a user, but does not give a third-party app permission to spend that user&apos;s ChatGPT subscription.</p>
        <div className="ai-advisor-actions"><button className="button primary" onClick={runAiReview} disabled={aiBusy || aiAvailable !== true} type="button">{aiBusy ? "Reviewing the cardboard…" : aiAvailable === null ? "Checking AI setup…" : aiAvailable === false ? "API key not configured" : aiReview ? "Refresh AI review" : "Generate AI review"}</button><span>{desktopMode ? "Your key is encrypted for your Windows user account and never enters browser storage. API billing is separate." : "The hosted tester has no personal API-key storage. API billing is separate."}</span></div>
        {aiAvailable === false && !aiError && <div className="ai-advisor-message bad"><strong>Optional model review is not connected.</strong><p>The live Scryfall/EDHREC analysis and swap ranking still work.{desktopMode ? " Add an OpenAI API key in Settings when you want the extra opinionated robot." : " Secure user API-key setup is available in the downloadable desktop build."}</p>{desktopMode && <button className="button ghost" onClick={() => setDesktopSettingsOpen(true)} type="button">Open Settings</button>}</div>}
        {aiError && <div className="ai-advisor-message bad"><strong>AI review is not configured yet.</strong><p>{aiError}</p></div>}
        {aiReview && <div className="ai-advisor-message"><strong>Advisor notes</strong><p>{aiReview}</p></div>}
      </section>}

      {pendingImport && pendingCounts ? (
        <section className="import-audit">
          <div className="import-audit-heading">
            <div><span className="eyebrow">Import checkpoint</span><h2>Check the zones before anything counts.</h2><p>{pendingImport.name}</p></div>
            <div className="audit-total"><strong>{pendingCounts.deckTotal}</strong><span>Commander + main</span><small>{pendingCounts.outsideTotal} outside deck</small></div>
          </div>
          <div className="zone-count-grid">
            {allDeckZones.map((zone) => <div className={isCountedZone(zone) ? "counts" : "outside"} key={zone}><span>{zoneLabels[zone]}</span><strong>{pendingCounts.byZone[zone]}</strong><small>{isCountedZone(zone) ? "Counts toward 100" : zone === "maybeboard" ? "Becomes proposals" : "Never counts"}</small></div>)}
          </div>
          {pendingImport.warnings.length > 0 && <div className="audit-warnings"><strong>Import notes</strong><ul>{pendingImport.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
          <div className="audit-zone-list">
            {allDeckZones.map((zone) => {
              const cards = pendingImport.entries.filter((entry) => entry.zone === zone);
              if (!cards.length) return null;
              return <details key={zone} open={isCountedZone(zone)}><summary><span>{zoneLabels[zone]}</span><b>{cards.reduce((sum, entry) => sum + entry.quantity, 0)}</b></summary><div className="audit-cards">{cards.map((entry) => <article className="audit-card" key={entry.recordId}>
                <button className="audit-card-preview" onClick={() => setPreviewCard(entry.card)} type="button" aria-label={`View ${entry.card.name}`}>
                  {imageFor(entry.card, "small") ? <img src={imageFor(entry.card, "small")} alt={entry.card.name} /> : <div className="audit-card-fallback">SBS</div>}
                </button>
                <div><strong>{entry.quantity}× {entry.card.name}</strong><span>{printingLabel(entry.card)}</span>{entry.groupLabels.length > 0 && <small>Source group: {entry.groupLabels.join(" · ")}</small>}</div>
                <label><span>Zone</span><select value={entry.zone} onChange={(event) => movePendingEntry(entry.recordId, event.target.value as DeckZone)}>{allDeckZones.map((option) => <option value={option} key={option}>{zoneLabels[option]}</option>)}</select></label>
              </article>)}</div></details>;
            })}
          </div>
          <div className="audit-actions"><button className="button ghost" onClick={() => setPendingImport(null)} type="button">Cancel import</button><div><span>Nothing enters the editor until you confirm.</span><button className="button primary" onClick={confirmPendingImport} type="button">Confirm zones &amp; load deck</button></div></div>
        </section>
      ) : deck.length === 0 ? (
        <section className="launch-layout">
          <div className="launch-copy">
            <span className="eyebrow">Deck triage without the hive-mind nonsense</span>
            <h2>Build the deck you meant to build.</h2>
            <p>Import a Commander deck, assemble a proposal pool, and compare every tempting piece of cardboard against what it would actually replace.</p>
            <div className="feature-row"><span>Live card data</span><span>Real card images</span><span>Contextual swaps</span></div>
            <div className="hero-art-wrap" aria-hidden="true"><img src="/art/hero-card-fan.png" alt="" className="hero-card-fan" /></div>
          </div>
          <div className="import-card">
            <div className="section-heading"><div><span className="step-number">01</span><h3>Summon your deck</h3></div><button className="text-button" onClick={() => importDeck("demo")} disabled={busy} type="button">Try CatDog demo</button></div>
            <label className="field-label" htmlFor="deck-url">Public Archidekt or Moxfield link</label>
            <div className="input-action-row"><input id="deck-url" value={deckUrl} onChange={(event) => setDeckUrl(event.target.value)} placeholder="https://archidekt.com/decks/... or moxfield.com/decks/..." /><button className="button gold" disabled={busy || !deckUrl.trim()} onClick={() => importDeck("url")} type="button">Import</button></div>
            <div className="or-divider"><span>or paste a decklist</span></div>
            <label className="field-label" htmlFor="deck-text">One card per line</label>
            <textarea id="deck-text" value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={"Commander\n1 Rin and Seri, Inseparable\n\nDeck\n1 Sol Ring\n1 Beast Within"} />
            <button className="button primary wide" disabled={busy || !importText.trim()} onClick={() => importDeck("text")} type="button">{busy ? "Consulting the cardboard spirits…" : "Load deck"}</button>
            {notice && <p className="notice">{notice}</p>}
            <p className="microcopy">Public links only. Archidekt imports directly. Moxfield exports paste cleanly with exact set codes; direct Moxfield links may require the paste fallback when its anti-bot ward says “absolutely not.” Nothing is written back.</p>
          </div>
        </section>
      ) : (
        <>
          <section className="deck-identity-bar">
            <div className="deck-title-block"><span className="eyebrow">Current workshop</span><input className="deck-name-input" value={deckName} onChange={(event) => setDeckName(event.target.value)} aria-label="Deck name" /><input className="strategy-input" value={strategy} onChange={(event) => setStrategy(event.target.value)} aria-label="Deck strategy" /></div>
            <div className="power-control"><span>Play bracket · user controlled</span><div className="bracket-buttons"><button className={power === null ? "active" : ""} onClick={() => { setPower(null); setBracketSource(null); }} type="button" aria-label="Bracket not set">?</button>{[1, 2, 3, 4, 5].map((value) => <button key={value} className={power === value ? "active" : ""} onClick={() => { setPower(value); setBracketSource("You"); }} type="button">{value}</button>)}</div><small>{power !== null && bracketFloor && power < bracketFloor ? `Conflict: ${stats.gameChangers} Game Changer${stats.gameChangers === 1 ? "" : "s"} require bracket ${bracketFloor}+` : bracketSource ? `Reported by ${bracketSource}` : bracketFloor ? `${stats.gameChangers} Game Changer${stats.gameChangers === 1 ? "" : "s"} · official floor ${bracketFloor}` : "Not guessed from vibes"}</small></div>
          </section>
          <nav className="workspace-tabs" aria-label="Deck editor views">
            <button className={view === "deck" ? "active" : ""} onClick={() => setView("deck")} type="button">Current Deck <span>{stats.total}</span></button>
            <button className={view === "proposed" ? "active" : ""} onClick={() => setView("proposed")} type="button">Proposed Cards <span>{evaluationCandidates.length}</span></button>
            <button className={view === "swaps" ? "active" : ""} onClick={() => setView("swaps")} type="button">Swap Lab <span>↗</span></button>
          </nav>
          <section className="metric-strip">
            <div><span>Deck total</span><strong>{stats.total}</strong><small>{stats.total === 100 ? `${stats.commanders} commander${stats.commanders === 1 ? "" : "s"} included` : `${Math.abs(100 - stats.total)} ${stats.total < 100 ? "short" : "over"} · ${stats.commanders} commander${stats.commanders === 1 ? "" : "s"}`}</small></div><div><span>Lands</span><strong>{stats.lands}</strong><small>Never auto-cut</small></div><div><span>Avg. mana</span><strong>{stats.average.toFixed(2)}</strong><small>Nonlands</small></div><div><span>Ramp</span><strong>{stats.ramp}</strong><small>Target 10</small></div><div><span>Draw</span><strong>{stats.draw}</strong><small>Target 10</small></div><div><span>Interaction</span><strong>{stats.interaction}</strong><small>+ {stats.wipes} wipes</small></div><div><span>Game Changers</span><strong>{stats.gameChangers}</strong><small>{bracketFloor ? `Bracket ${bracketFloor}+ signal` : "No automatic floor"}</small></div><div><span>Outside deck</span><strong>{stats.extraCount + candidates.reduce((sum, entry) => sum + entry.quantity, 0)}</strong><small>Maybe · side · tokens</small></div>
          </section>
          {extras.length > 0 && <details className="extras-strip"><summary>{stats.extraCount} imported card{stats.extraCount === 1 ? "" : "s"} correctly excluded from the 100-card count</summary><div>{(["sideboard", "companion", "token"] as DeckZone[]).map((zone) => { const count = extras.filter((entry) => entry.zone === zone).reduce((sum, entry) => sum + entry.quantity, 0); return count ? <span key={zone}>{zone === "token" ? "Tokens" : `${zone[0].toUpperCase()}${zone.slice(1)}`}: {count}</span> : null; })}</div></details>}
          {notice && <div className="workspace-notice"><span>{notice}</span><button onClick={() => setNotice("")} type="button" aria-label="Dismiss">×</button></div>}
          <div className="workspace-grid">
            <section className="main-workspace">
              {view === "deck" && <>
                <div className="panel-heading deck-heading">
                  <div><span className="eyebrow">Your 100-ish</span><h2>Current deck</h2></div>
                  <div className="sort-control" aria-label="Sort current deck">
                    <span>Sort</span>
                    <button className={deckSort === "type" ? "active" : ""} onClick={() => setDeckSort("type")} type="button">Type</button>
                    <button className={deckSort === "curve" ? "active" : ""} onClick={() => setDeckSort("curve")} type="button">Mana value</button>
                    <button className={deckSort === "cuts" ? "active" : ""} onClick={() => setDeckSort("cuts")} type="button">Cut rank</button>
                    <button className={deckSort === "name" ? "active" : ""} onClick={() => setDeckSort("name")} type="button">A–Z</button>
                  </div>
                </div>
                {deckSort === "type" ? <div className="type-groups">{groupedDeck.map((group) => <section className="type-group" key={group.type}><div className="type-group-heading"><h3>{group.type}</h3><span>{group.cards.reduce((sum, entry) => sum + entry.quantity, 0)}</span></div><div className="card-grid">{group.cards.map((entry) => <CardTile key={entry.recordId} entry={entry} selected={selectedId === entry.recordId} onSelect={() => { setSelectedId(entry.recordId); setInspectedCard(entry.card); }} onPreview={setPreviewCard} />)}</div></section>)}</div> : <div className="card-grid">{rankedDeck.map((entry) => {
                  const analysis = currentAnalyses.get(entry.card.id)!;
                  return <CardTile key={entry.recordId} entry={entry} selected={selectedId === entry.recordId} onSelect={() => { setSelectedId(entry.recordId); setInspectedCard(entry.card); }} onPreview={setPreviewCard} badge={deckSort === "cuts" ? `${analysis.pressure} · ${analysis.label}` : undefined} />;
                })}</div>}
              </>}
              {view === "proposed" && <>
                <div className="panel-heading proposal-heading">
                  <div><span className="eyebrow">Maybeboard with opinions</span><h2>Proposed cards</h2></div>
                  <div className="card-search"><input value={search} onChange={(event) => { const value = event.target.value; setSearch(value); if (value.trim().length < 2) setSuggestions([]); }} placeholder="Search any card…" aria-label="Search Scryfall cards" />{suggestions.length > 0 && <div className="suggestions">{suggestions.map((name) => <button key={name} onClick={() => addSuggestion(name)} type="button">{name}</button>)}</div>}</div>
                </div>
                {commanderKey && <section className="idea-shelf">
                  <div className="subheading"><div><span className="eyebrow">Live commander suggestions · separate from your proposals</span><h3>Suggested adds from EDHREC</h3></div><div className="idea-actions">{edhrecSource && <a href={edhrecSource} target="_blank" rel="noreferrer">Open source ↗</a>}<button className="text-button" onClick={() => setSuggestionRefresh((value) => value + 1)} disabled={edhrecBusy} type="button">Refresh suggestions</button></div></div>
                  {edhrecBusy ? <p className="inline-empty">Checking what the cardboard hive mind puts beside this commander…</p> : edhrecError ? <div className="inline-empty suggestion-error"><strong>Suggestions could not load.</strong><span>{edhrecError}</span><button className="button ghost" onClick={() => setSuggestionRefresh((value) => value + 1)} type="button">Try again</button></div> : visibleEdhrecIdeas.length ? <div className="idea-grid">{visibleEdhrecIdeas.map((idea) => <article className="idea-card" key={idea.entry.recordId}><button className="idea-card-preview" onClick={() => setInspectedCard(idea.entry.card)} onDoubleClick={() => setPreviewCard(idea.entry.card)} type="button" aria-label={`Inspect ${idea.entry.card.name}. Double-click to expand.`} title="Click to inspect · double-click to expand"><img src={imageFor(idea.entry.card, "small")} alt={idea.entry.card.name} loading="lazy" /></button><div><strong>{idea.entry.card.name}</strong><span>{printingLabel(idea.entry.card)}</span><p>{idea.label}{typeof idea.synergy === "number" ? ` · ${Math.round(idea.synergy * 100)}% synergy` : ""}{typeof idea.inclusion === "number" ? ` · ${Math.round(idea.inclusion * 100)}% inclusion` : ""}</p><button className="button primary" onClick={() => addEdhrecIdea(idea)} type="button">Move to proposals</button></div></article>)}</div> : <p className="inline-empty">No unused suggestions remain for this commander. Refresh to check again.</p>}
                </section>}
                <details className="bulk-add"><summary>Paste several proposed cards</summary><textarea value={candidateText} onChange={(event) => setCandidateText(event.target.value)} placeholder={"1 Long-Bodied Grey Dog\n1 Maskwood Nexus\n1 Jetmir, Nexus of Revels"} /><button className="button primary" disabled={busy || !candidateText.trim()} onClick={importCandidates} type="button">Add proposal list</button></details>
                {sideboardCandidates.length > 0 && <section className="sideboard-shelf">
                  <div className="subheading"><div><span className="eyebrow">Imported sideboard · eligible additions</span><h3>Already waiting in the wings</h3><p>These stay outside the 100 until you confirm an add or swap. Confirming moves one copy into the deck instead of cloning the cardboard.</p></div><span>{sideboardCandidates.reduce((sum, entry) => sum + entry.quantity, 0)} sideboard card{sideboardCandidates.reduce((sum, entry) => sum + entry.quantity, 0) === 1 ? "" : "s"}</span></div>
                  <div className="card-grid">{sideboardCandidates.map((entry) => {
                    const analysis = candidateAnalyses.get(entry.card.id);
                    return <CardTile key={entry.recordId} entry={entry} selected={selectedId === entry.recordId} onSelect={() => { setSelectedId(entry.recordId); setInspectedCard(entry.card); }} onPreview={setPreviewCard} badge={analysis ? `Sideboard · ${analysis.score} · ${analysis.verdict}` : "Sideboard · analyzing"} />;
                  })}</div>
                </section>}
                {candidates.length > 0 && <section>
                  <div className="subheading"><div><span className="eyebrow">Maybeboard and searched additions</span><h3>Your proposal pool</h3></div><span>{candidates.length} card{candidates.length === 1 ? "" : "s"}</span></div>
                  <div className="card-grid">{candidates.map((entry) => {
                    const analysis = candidateAnalyses.get(entry.card.id);
                    return <CardTile key={entry.recordId} entry={entry} selected={selectedId === entry.recordId} onSelect={() => { setSelectedId(entry.recordId); setInspectedCard(entry.card); }} onPreview={setPreviewCard} badge={analysis ? `${analysis.score} · ${analysis.verdict}` : "Analyzing"} />;
                  })}</div>
                </section>}
                {evaluationCandidates.length === 0 && <div className="empty-state"><strong>No temptations yet.</strong><p>Search Scryfall, paste your maybeboard, or import a deck with a sideboard. We support your poor impulse control.</p></div>}
              </>}
              {view === "swaps" && <div className="swap-lab">
                {activeCandidate && activeAnalysis ? <>
                  <div className="panel-heading swap-heading">
                    <div><span className="eyebrow">Before / after</span><h2>The Swap Lab</h2></div>
                    <span className="panel-hint">One proposal at a time · compare first · confirm once · undo anytime</span>
                  </div>
                  <div className="candidate-rail" aria-label="Choose proposed card">
                    {evaluationCandidates.map((entry) => {
                      const analysis = candidateAnalyses.get(entry.card.id)!;
                      return <button key={entry.recordId} className={entry.recordId === activeCandidate.recordId ? "active" : ""} onClick={() => { setSelectedId(entry.recordId); setInspectedCard(entry.card); setPreviewCutId(null); }} onDoubleClick={() => setPreviewCard(entry.card)} type="button" title="Click to inspect · double-click to expand"><img src={imageFor(entry.card, "small")} alt="" /><span>{entry.card.name}<small>{entry.zone === "sideboard" ? "Sideboard · " : ""}{analysis.score} · {analysis.verdict}</small></span></button>;
                    })}
                  </div>
                  <div className="candidate-report">
                    <div className={`fit-score ${activeAnalysis.tone}`}><strong>{activeAnalysis.score}</strong><span>Fit score</span></div>
                    <div><span className="eyebrow">{activeCandidate.zone === "sideboard" ? "Sideboard candidate" : "Verdict"}</span><h3>{activeAnalysis.verdict}</h3><p>{activeAnalysis.reasons[0]}</p></div>
                    <div className="candidate-report-actions"><button className="button ghost" onClick={() => setPreviewCard(activeCandidate.card)} type="button">Expand card</button>{stats.total < 100 && activeAnalysis.legal && <button className="button primary" onClick={() => addToDeck(activeCandidate)} type="button">{activeCandidate.zone === "sideboard" ? "Move into open slot" : "Confirm add to open slot"}</button>}</div>
                  </div>
                  <div className="thought-grid">
                    <div><h3>Why it works</h3><ul>{activeAnalysis.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>
                    <div><h3>Watch for</h3><ul>{activeAnalysis.cautions.length ? activeAnalysis.cautions.map((reason) => <li key={reason}>{reason}</li>) : <li>No major structural warning detected.</li>}</ul></div>
                  </div>
                  {stats.total >= 100 && <section className="replacement-section">
                    <div className="subheading"><div><span className="eyebrow">Ranked replacements</span><h3>Compare before you cut</h3></div><span>Lands, locked cards, and commanders are excluded · Game Changers are strongly protected</span></div>
                    {previewSwap && <section className="swap-preview" aria-label={`Compare ${previewSwap.cut.card.name} with ${activeCandidate.card.name}`}>
                      <div className="compare-card leaving">
                        <div className="compare-label">Would leave</div>
                        <button className="compare-card-preview" onClick={() => setInspectedCard(previewSwap.cut.card)} onDoubleClick={() => setPreviewCard(previewSwap.cut.card)} type="button" aria-label={`Inspect ${previewSwap.cut.card.name}. Double-click to expand.`} title="Click to inspect · double-click to expand"><img src={imageFor(previewSwap.cut.card)} alt={previewSwap.cut.card.name} /></button>
                        <div><h4>{previewSwap.cut.card.name}</h4><span>{printingLabel(previewSwap.cut.card)}</span>{previewSwap.cut.card.game_changer && <b className="compare-flag">Game Changer · strong keep</b>}<p>{previewSwap.cut.card.type_line} · MV {previewSwap.cut.card.cmc}</p><div className="role-chips compact">{classify(previewSwap.cut.card).map((role) => <span key={role}>{role}</span>)}</div><blockquote>{oracleText(previewSwap.cut.card) || "No rules text."}</blockquote></div>
                      </div>
                      <div className="swap-arrow" aria-hidden="true"><span>→</span><small>{previewSwap.manaDelta > 0 ? "+" : ""}{previewSwap.manaDelta} MV</small></div>
                      <div className="compare-card entering">
                        <div className="compare-label">Would enter{activeCandidate.zone === "sideboard" ? " · from sideboard" : ""}</div>
                        <button className="compare-card-preview" onClick={() => setInspectedCard(activeCandidate.card)} onDoubleClick={() => setPreviewCard(activeCandidate.card)} type="button" aria-label={`Inspect ${activeCandidate.card.name}. Double-click to expand.`} title="Click to inspect · double-click to expand"><img src={imageFor(activeCandidate.card)} alt={activeCandidate.card.name} /></button>
                        <div><h4>{activeCandidate.card.name}</h4><span>{printingLabel(activeCandidate.card)}</span>{activeCandidate.card.game_changer && <b className="compare-flag">Game Changer</b>}<p>{activeCandidate.card.type_line} · MV {activeCandidate.card.cmc}</p><div className="role-chips compact">{classify(activeCandidate.card).map((role) => <span key={role}>{role}</span>)}</div><blockquote>{oracleText(activeCandidate.card) || "No rules text."}</blockquote></div>
                      </div>
                      <div className="swap-preview-decision"><div><span className="eyebrow">Selected trade</span><h4>{previewSwap.label} · {previewSwap.score}%</h4><ul>{previewSwap.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><div className="delta-chips">{previewSwap.gained.map((role) => <i className="good" key={`preview-gain-${role}`}>+ {role}</i>)}{previewSwap.lost.map((role) => <i className="warn" key={`preview-loss-${role}`}>− {role}</i>)}</div></div><button className="button primary" onClick={() => addToDeck(activeCandidate, previewSwap.cut)} type="button">Confirm this swap</button></div>
                    </section>}
                    {activeSwaps.length ? <div className="replacement-list">{activeSwaps.map((option, index) => <article key={option.cut.recordId} className={`replacement-row ${previewSwap?.cut.recordId === option.cut.recordId ? "is-previewed" : ""}`}>
                      <span className="rank-number">{String(index + 1).padStart(2, "0")}</span>
                      <button className="replacement-card-preview" onClick={() => setInspectedCard(option.cut.card)} onDoubleClick={() => setPreviewCard(option.cut.card)} type="button" aria-label={`Inspect ${option.cut.card.name}. Double-click to expand.`} title="Click to inspect · double-click to expand"><img src={imageFor(option.cut.card, "small")} alt={option.cut.card.name} /></button>
                      <div className="replacement-copy"><strong>{option.cut.card.name}{option.cut.card.game_changer ? " · Game Changer" : ""}</strong><span>{option.label} · {option.score}%</span><p>{option.reasons.join(" ")}</p><div className="delta-chips">{option.manaDelta !== 0 && <i className={option.manaDelta < 0 ? "good" : "warn"}>{option.manaDelta > 0 ? "+" : ""}{option.manaDelta} mana</i>}{option.gained.map((role) => <i className="good" key={`gain-${role}`}>+ {role}</i>)}{option.lost.map((role) => <i className="warn" key={`loss-${role}`}>− {role}</i>)}</div></div>
                      <div className="replacement-actions"><button className="button ghost" onClick={() => setPreviewCutId(option.cut.recordId)} type="button">Compare</button></div>
                    </article>)}</div> : <div className="inline-empty">Every removable card is protected. The cut goblin has been unionized.</div>}
                  </section>}
                </> : <div className="swap-intro"><span className="eyebrow">Before / after</span><h2>The Swap Lab</h2><p>{evaluationCandidates.length ? "Choose a legal proposed or sideboard card to compare." : "All proposed swaps are resolved. Your updated import list is ready below—or add more temptations."}</p><button className="button primary" onClick={() => setView("proposed")} type="button">Add proposed cards</button></div>}
                <section className="updated-export">
                  <div className="updated-export-heading"><div><span className="eyebrow">After the swaps</span><h3>Updated Archidekt / Moxfield list</h3><p>Every line keeps the chosen Scryfall set code and collector number. Commander and main deck only—tokens, sideboard, and maybeboard stay out of the 100.</p></div><div><button className="button primary" onClick={copyUpdatedDecklist} type="button">Copy updated list</button><button className="button ghost" onClick={downloadUpdatedDecklist} type="button">Download .txt</button></div></div>
                  <textarea className="export-preview" readOnly value={decklistText(false)} aria-label="Updated exact-print decklist" />
                </section>
              </div>}
            </section>
            <aside className="card-inspector">
              {inspectorCard ? <>
                <div className="inspector-image-wrap"><button className="inspector-image-preview" onClick={() => setPreviewCard(inspectorCard)} type="button" aria-label={`Expand ${inspectorCard.name}`} title="Expand card"><span className="inspector-expand-label">Expand ↗</span>{faceImage(inspectorCard, faceIndex) ? <img src={faceImage(inspectorCard, faceIndex)} alt={inspectorCard.card_faces?.[faceIndex]?.name ?? inspectorCard.name} className="inspector-image" /> : <div className="card-art-fallback large">{inspectorCard.name}</div>}</button>{inspectorCard.card_faces && inspectorCard.card_faces.length > 1 && <button className="face-note" onClick={() => setFaceIndex((current) => (current + 1) % inspectorCard.card_faces!.length)} type="button">↻ Flip card</button>}</div>
                <div className="inspector-content">
                  <span className="eyebrow">Last card clicked</span><h2>{inspectorCard.card_faces?.[faceIndex]?.name ?? inspectorCard.name}</h2>{inspectorCard.game_changer && <div className="game-changer-callout">Game Changer · strong default keep</div>}<p className="type-line">{inspectorCard.card_faces?.[faceIndex]?.type_line ?? inspectorCard.type_line}</p>
                  <div className="role-chips">{classify(inspectorCard).map((role) => <span key={role}>{role}</span>)}</div>
                  <p className="oracle-text">{inspectorCard.card_faces?.[faceIndex]?.oracle_text ?? (oracleText(inspectorCard) || "No rules text. Just vibes and basic land privilege.")}</p>
                  <dl className="card-facts"><div><dt>Mana value</dt><dd>{inspectorCard.cmc}</dd></div><div><dt>Colors</dt><dd>{inspectorCard.color_identity.join("") || "Colorless"}</dd></div><div><dt>Set</dt><dd>{inspectorCard.set_name ?? inspectorCard.set?.toUpperCase()}</dd></div><div><dt>Exact print</dt><dd>{printingLabel(inspectorCard)}</dd></div><div><dt>EDHREC rank</dt><dd>{inspectorCard.edhrec_rank ? `#${inspectorCard.edhrec_rank.toLocaleString()}` : "Unranked"}</dd></div><div><dt>USD</dt><dd>{inspectorCard.prices?.usd ? `$${inspectorCard.prices.usd}` : "—"}</dd></div></dl>
                  {inspectorCard.scryfall_uri && <a className="card-source-link" href={inspectorCard.scryfall_uri} target="_blank" rel="noreferrer">Open this exact printing on Scryfall ↗</a>}
                  {inspectorEntry && evaluationCandidates.some((entry) => entry.recordId === inspectorEntry.recordId) && candidateAnalyses.get(inspectorCard.id) && <div className={`inspector-verdict ${candidateAnalyses.get(inspectorCard.id)!.tone}`}><strong>{candidateAnalyses.get(inspectorCard.id)!.score}</strong><span>{candidateAnalyses.get(inspectorCard.id)!.verdict}</span></div>}
                  {inspectorEntry && deck.some((entry) => entry.recordId === inspectorEntry.recordId) && currentAnalyses.get(inspectorCard.id) && <><div className={`inspector-verdict ${currentAnalyses.get(inspectorCard.id)!.tone}`}><strong>{currentAnalyses.get(inspectorCard.id)!.pressure}</strong><span>{currentAnalyses.get(inspectorCard.id)!.label}{isLandCard(inspectorCard) ? "" : " · cut pressure"}</span></div><ul className="inspector-thoughts">{currentAnalyses.get(inspectorCard.id)!.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></>}
                  {inspectorEntry && deck.some((entry) => entry.recordId === inspectorEntry.recordId) ? <>
                    <button className={`button wide ${inspectorEntry.locked || isLandCard(inspectorCard) ? "gold" : "ghost"}`} onClick={toggleLock} disabled={inspectorEntry.commander || isLandCard(inspectorCard)} type="button">{inspectorEntry.commander ? "Commander · permanently locked" : isLandCard(inspectorCard) ? "Land · excluded from automatic cuts" : inspectorEntry.locked ? "Protected from cuts" : "Protect this card"}</button>
                    {!inspectorEntry.commander && <button className="text-button wide-text" onClick={markCommander} type="button">Mark as commander / partner</button>}
                  </> : inspectorEntry && evaluationCandidates.some((entry) => entry.recordId === inspectorEntry.recordId) ? <>
                    {inspectorEntry.zone === "sideboard" && <span className="sideboard-origin">Imported sideboard · outside the 100 until confirmed</span>}
                    <button className="button primary wide" onClick={() => setView("swaps")} disabled={!candidateAnalyses.get(inspectorCard.id)?.legal} type="button">Open in Swap Lab</button>
                    {inspectorEntry.zone !== "sideboard" && <button className="button ghost wide" onClick={removeSelected} type="button">Remove from proposals</button>}
                  </> : null}
                </div>
              </> : <div className="inspector-empty"><img src="/sbs-mark.svg" alt="" /><strong>Select a card</strong><p>Its current Oracle text, image, roles, price, and eventual crimes will appear here.</p></div>}
            </aside>
          </div>
        </>
      )}
      {desktopSettingsOpen && <DesktopSettingsDialog status={desktopApiStatus} busy={desktopSettingsBusy} error={desktopSettingsError} onSave={saveDesktopApiKey} onClear={clearDesktopApiKey} onClose={() => setDesktopSettingsOpen(false)} />}
      {previewCard && <CardPreviewDialog key={previewCard.id} card={previewCard} onClose={() => setPreviewCard(null)} />}
      <footer><span>SaltyBananaSlug&apos;s MTG Deck Editor</span><p>Card data and images via Scryfall; commander suggestions via EDHREC. Imports understand Archidekt, Moxfield export text, and plain text. Not affiliated with or endorsed by Wizards of the Coast—or the Dimir, allegedly.</p></footer>
    </main>
  );
}
