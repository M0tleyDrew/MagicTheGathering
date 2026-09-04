import { useMemo, useState, type ChangeEvent } from 'react';
import { getPreferredArt, searchScryfallCards } from './lib/scryfall';
import type { CardColor, CardDraft, CardStyle, Rarity, ScryfallCardSummary } from './types';

const COLORS: CardColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];
const STYLES: Array<{ value: CardStyle; label: string }> = [
  { value: 'standard', label: 'Standard Proxy' },
  { value: 'borderless', label: 'Borderless' },
  { value: 'full-art', label: 'Full Art' },
  { value: 'full-art-land', label: 'Full-Art Land' },
  { value: 'token', label: 'Token' },
  { value: 'minimal-token', label: 'Minimal Token' },
  { value: 'retro', label: 'Retro' },
];

const DEFAULT_CARD: CardDraft = {
  id: crypto.randomUUID(),
  name: 'Untitled Proxy',
  manaCost: '{2}{G}',
  manaValue: 3,
  colors: ['G'],
  typeLine: 'Creature — Slug Wizard',
  rulesText: 'When this creature enters, create a Food token.\n{T}: Add {G}.',
  flavorText: 'Legally distinct. Spiritually questionable.',
  power: '2',
  toughness: '3',
  loyalty: '',
  defense: '',
  style: 'standard',
  rarity: 'rare',
  setCode: 'SBS',
  collectorNumber: '001',
  artistCredit: '',
  footerText: 'PROXY • Not for sale',
  artDataUrl: '',
  setSymbolDataUrl: '',
};

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read image'));
    reader.readAsDataURL(file);
  });
}

function renderMana(text: string) {
  const parts = text.split(/(\{[^}]+\})/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('{') && part.endsWith('}')) {
      return <span className="mana-symbol" key={`${part}-${index}`}>{part.slice(1, -1)}</span>;
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function cardFrameClass(colors: CardColor[]) {
  if (colors.length === 0 || colors.includes('C')) return 'frame-colorless';
  if (colors.length > 1) return 'frame-multicolor';
  return `frame-${colors[0].toLowerCase()}`;
}

function getPrimaryFace(card: ScryfallCardSummary) {
  return card.card_faces?.[0];
}

function normalizeRarity(rarity: string): Rarity {
  if (rarity === 'common' || rarity === 'uncommon' || rarity === 'rare' || rarity === 'mythic') return rarity;
  return 'special';
}

export default function App() {
  const [card, setCard] = useState<CardDraft>(DEFAULT_CARD);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<ScryfallCardSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  const frameClass = useMemo(() => cardFrameClass(card.colors), [card.colors]);

  function patch<K extends keyof CardDraft>(key: K, value: CardDraft[K]) {
    setCard((current) => ({ ...current, [key]: value }));
  }

  function toggleColor(color: CardColor) {
    setCard((current) => ({
      ...current,
      colors: current.colors.includes(color)
        ? current.colors.filter((item) => item !== color)
        : [...current.colors.filter((item) => item !== 'C' || color === 'C'), color],
    }));
  }

  async function uploadArt(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) patch('artDataUrl', await readImage(file));
  }

  async function uploadSetSymbol(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) patch('setSymbolDataUrl', await readImage(file));
  }

  async function runSearch() {
    setSearching(true);
    setSearchError('');
    try {
      setResults(await searchScryfallCards(search));
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Scryfall search failed');
    } finally {
      setSearching(false);
    }
  }

  function importCard(source: ScryfallCardSummary) {
    const face = getPrimaryFace(source);
    const sourceColors = (source.colors ?? source.color_identity ?? []).filter((value): value is CardColor => COLORS.includes(value as CardColor));
    setCard((current) => ({
      ...current,
      name: face?.name ?? source.name,
      manaCost: face?.mana_cost ?? source.mana_cost ?? '',
      manaValue: source.cmc ?? 0,
      colors: sourceColors.length ? sourceColors : ['C'],
      typeLine: face?.type_line ?? source.type_line ?? '',
      rulesText: face?.oracle_text ?? source.oracle_text ?? '',
      flavorText: face?.flavor_text ?? source.flavor_text ?? '',
      power: face?.power ?? source.power ?? '',
      toughness: face?.toughness ?? source.toughness ?? '',
      loyalty: face?.loyalty ?? source.loyalty ?? '',
      defense: face?.defense ?? source.defense ?? '',
      rarity: normalizeRarity(source.rarity),
      setCode: source.set.toUpperCase(),
      collectorNumber: source.collector_number,
      artistCredit: source.artist ?? '',
      artDataUrl: getPreferredArt(source),
      sourceScryfallId: source.id,
    }));
  }

  function saveProject() {
    const blob = new Blob([JSON.stringify({ format: 'sbsproxy', version: 1, card }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${card.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'proxy'}.sbsproxy.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">SaltyBananaSlug</p>
          <h1>Proxy Builder</h1>
        </div>
        <div className="top-actions">
          <button className="secondary" onClick={() => setCard({ ...DEFAULT_CARD, id: crypto.randomUUID() })}>New Card</button>
          <button onClick={saveProject}>Save Project</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="editor-panel">
          <section className="panel-card scryfall-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Helper</p>
                <h2>Import from Scryfall</h2>
              </div>
            </div>
            <div className="search-row">
              <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void runSearch()} placeholder="Search a card or Scryfall query…" />
              <button onClick={() => void runSearch()} disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
            </div>
            {searchError && <p className="error-text">{searchError}</p>}
            {results.length > 0 && (
              <div className="search-results">
                {results.map((result) => (
                  <button className="search-result" key={result.id} onClick={() => importCard(result)}>
                    <strong>{result.name}</strong>
                    <span>{result.set.toUpperCase()} #{result.collector_number} · {result.type_line}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="panel-card">
            <div className="section-heading"><h2>Card</h2><span className="status-pill">Live</span></div>
            <label>Name<input value={card.name} onChange={(event) => patch('name', event.target.value)} /></label>
            <div className="two-col">
              <label>Mana cost<input value={card.manaCost} onChange={(event) => patch('manaCost', event.target.value)} placeholder="{2}{U}{R}" /></label>
              <label>Mana value<input type="number" min="0" value={card.manaValue} onChange={(event) => patch('manaValue', Number(event.target.value))} /></label>
            </div>
            <label>Colors</label>
            <div className="color-picker">
              {COLORS.map((color) => <button key={color} className={card.colors.includes(color) ? 'selected' : ''} onClick={() => toggleColor(color)}>{color}</button>)}
            </div>
            <label>Type line<input value={card.typeLine} onChange={(event) => patch('typeLine', event.target.value)} /></label>
            <label>Rules text<textarea rows={6} value={card.rulesText} onChange={(event) => patch('rulesText', event.target.value)} /></label>
            <label>Flavor text<textarea rows={3} value={card.flavorText} onChange={(event) => patch('flavorText', event.target.value)} /></label>
            <div className="four-col">
              <label>Power<input value={card.power} onChange={(event) => patch('power', event.target.value)} /></label>
              <label>Toughness<input value={card.toughness} onChange={(event) => patch('toughness', event.target.value)} /></label>
              <label>Loyalty<input value={card.loyalty} onChange={(event) => patch('loyalty', event.target.value)} /></label>
              <label>Defense<input value={card.defense} onChange={(event) => patch('defense', event.target.value)} /></label>
            </div>
          </section>

          <section className="panel-card">
            <h2>Art & frame</h2>
            <div className="two-col">
              <label>Frame style<select value={card.style} onChange={(event) => patch('style', event.target.value as CardStyle)}>{STYLES.map((style) => <option key={style.value} value={style.value}>{style.label}</option>)}</select></label>
              <label>Rarity<select value={card.rarity} onChange={(event) => patch('rarity', event.target.value as Rarity)}><option value="common">Common</option><option value="uncommon">Uncommon</option><option value="rare">Rare</option><option value="mythic">Mythic</option><option value="special">Special</option></select></label>
            </div>
            <label>Card art<input type="file" accept="image/*" onChange={(event) => void uploadArt(event)} /></label>
            <label>Custom set symbol<input type="file" accept="image/*" onChange={(event) => void uploadSetSymbol(event)} /></label>
            <div className="two-col">
              <label>Set code<input maxLength={8} value={card.setCode} onChange={(event) => patch('setCode', event.target.value.toUpperCase())} /></label>
              <label>Collector #<input value={card.collectorNumber} onChange={(event) => patch('collectorNumber', event.target.value)} /></label>
            </div>
            <label>Artist / image credit<input value={card.artistCredit} onChange={(event) => patch('artistCredit', event.target.value)} /></label>
            <label>Proxy footer<input value={card.footerText} onChange={(event) => patch('footerText', event.target.value)} /></label>
          </section>
        </aside>

        <section className="preview-panel">
          <div className="preview-sticky">
            <div className={`proxy-card ${frameClass} style-${card.style}`}>
              {card.artDataUrl ? <img className="card-art" src={card.artDataUrl} alt="Selected card artwork" /> : <div className="card-art empty-art">Drop some glorious nonsense here.</div>}
              <div className="card-overlay" />
              <div className="card-title-row">
                <h3>{card.name || 'Untitled Proxy'}</h3>
                <div className="mana-cost">{renderMana(card.manaCost)}</div>
              </div>
              <div className="type-row">
                <strong>{card.typeLine || 'Card Type'}</strong>
                {card.setSymbolDataUrl ? <img className={`set-symbol rarity-${card.rarity}`} src={card.setSymbolDataUrl} alt="Custom set symbol" /> : <span className={`set-dot rarity-${card.rarity}`} title={`${card.rarity} set symbol placeholder`} />}
              </div>
              <div className="rules-box">
                <div className="rules-text">{card.rulesText.split('\n').map((line, index) => <p key={`${line}-${index}`}>{renderMana(line) || '\u00a0'}</p>)}</div>
                {card.flavorText && <p className="flavor-text">{card.flavorText}</p>}
              </div>
              {(card.power || card.toughness) && <div className="pt-box">{card.power || '0'}/{card.toughness || '0'}</div>}
              {card.loyalty && <div className="corner-stat loyalty">{card.loyalty}</div>}
              {card.defense && <div className="corner-stat defense">{card.defense}</div>}
              <div className="card-footer">
                <span>{card.setCode || 'SBS'} • {card.collectorNumber || '000'}</span>
                <span>{card.footerText}</span>
                {card.artistCredit && <span>Art: {card.artistCredit}</span>}
              </div>
            </div>
            <p className="preview-note">Custom proxy frame preview. Official Magic card backs are intentionally not part of the project.</p>
          </div>
        </section>
      </section>
    </main>
  );
}
