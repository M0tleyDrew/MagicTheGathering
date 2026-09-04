# SaltyBananaSlug's Proxy Builder

A custom Magic-style proxy and playtest-card builder focused on clearly non-counterfeit cards: custom fronts, custom or plain backs later, custom set symbols, original proxy frames, Scryfall-assisted imports, individual print-ready exports, and home-print proxy sheets.

## Current prototype

The `proxy-builder-v0` branch contains the first editor slice:

- Live editable card preview.
- Card name, mana cost, mana value, colors, type line, rules text, flavor text, power/toughness, loyalty, and defense.
- Standard, borderless, full-art, full-art land, token, minimal-token, and retro proxy styles.
- Local artwork upload.
- Local custom set-symbol upload.
- Rarity, set code, collector number, artist/image credit, and proxy footer.
- Scryfall search/import for an existing card printing, followed by unrestricted editing.
- Local `.sbsproxy.json` project save.
- No official Magic card back.

## Run locally

Requirements: Node.js 22.13+ and npm.

```bash
cd proxy-builder
npm install
npm run dev
```

Production build check:

```bash
npm run build
```

## Next implementation milestone

1. Export one card as a high-resolution PNG/JPG.
2. Print-service presets with safe area and bleed overlays.
3. Nine-card Letter/A4 PDF proxy sheets with cut guides and per-card quantities.
4. Project load/reopen and multi-card project/set support.
5. Desktop packaging using the same Electron approach as the existing MTG Deck Editor.
6. Custom proxy-card back editor (never the official MTG back).

## Scryfall

Card data and images are provided by Scryfall. The desktop/browser production architecture will cache requests and route live API calls through an application-controlled layer where needed so requests can follow Scryfall's API guidance.

Magic: The Gathering is property of Wizards of the Coast. This fan project is not affiliated with or endorsed by Wizards of the Coast or Scryfall. Proxies created with this tool are intended as playtest/proxy cards, not counterfeit cards.
