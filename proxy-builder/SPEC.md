# SaltyBananaSlug's Proxy Builder — Product Specification

## Product goal

Build a desktop-first proxy and custom playtest-card studio that lets a user either create a card from scratch or import a real Magic card through Scryfall and modify it. The tool must support high-resolution individual card exports for professional printing and printable multi-card proxy sheets for home use. It must remain clearly proxy-oriented and must not include the official Magic card back.

## Design principles

1. **Live editing:** every field change updates the preview immediately.
2. **Proxy-first:** custom/non-official frames and optional proxy markings are defaults.
3. **Print-aware:** safe area, bleed, crop guides, exact card dimensions, and high-resolution export are first-class features.
4. **Scryfall-assisted, not Scryfall-dependent:** imported cards become local editable project data.
5. **One card model, many frames:** styles should be renderers over the same data instead of separate card formats.
6. **Desktop first, reusable web core:** React/TypeScript UI with desktop packaging; keep the editor portable enough for a later mobile/PWA build.

## Card model

Required fields:

- Name/custom title
- Mana cost string with symbol tokens such as `{2}{W}{U}`, hybrid, Phyrexian, snow, X, and colorless
- Calculated mana value plus manual override
- Card colors / frame identity
- Supertype/type/subtype via editable type line
- Rules text with inline mana/tap symbols
- Flavor text
- Power/toughness
- Loyalty
- Defense
- Frame style
- Artwork and crop/position data
- Set symbol image
- Rarity
- Set code
- Collector number
- Artist/image credit
- Proxy footer text
- Optional Scryfall source ID/printing metadata

Future model fields:

- Multiple faces for transform/modal double-faced cards
- Adventure/split layout metadata
- Saga/chapter rendering hints
- Class/case/level rendering hints
- Prototype/mutate/special frame annotations if useful
- Custom back reference

## Frame styles

Initial:

- Standard proxy
- Borderless
- Full art
- Full-art land
- Token
- Minimal token
- Retro

Later:

- Planeswalker-specialized layout
- Battle-specialized layout
- Saga layout
- Split/adventure layouts
- User-defined SaltyBananaSlug frame packs

Frames should respond to white, blue, black, red, green, multicolor, artifact/colorless, and land identity. Do not rely on official Wizards frame artwork.

## Art workflow

- Upload PNG/JPG/WebP artwork.
- Drag to reposition.
- Zoom in/out.
- Fit/fill modes.
- Focal-point control.
- Optional full-bleed art.
- Preview safe area and bleed boundary.
- Persist crop/zoom state in the project file.

## Set-symbol workflow

- Upload a custom set image/symbol.
- Persist it with the card/project.
- Size and alignment controls.
- Optional rarity tinting.
- Saved set-symbol library for multi-card projects.
- Set code and collector number.

## Scryfall helper

Search by ordinary text or Scryfall syntax. Show matching printings. Import selected printing data including:

- Name
- Mana cost
- Mana value
- Colors/color identity
- Type line
- Oracle text
- Flavor text where present
- P/T, loyalty, or defense
- Set code
- Collector number
- Rarity
- Artist
- Available art/card images

After import, the card is detached into editable project data. Users may replace artwork, title, cost, text, symbol, frame, and metadata.

Networking requirements:

- Cache search results and printing data.
- Debounce live searches if added.
- Avoid redundant requests.
- Respect Scryfall rate-limit guidance.
- Use appropriate Accept/User-Agent headers from desktop/server-controlled requests where available.
- Prefer bulk data for any future large-scale/offline catalog feature.

## Export system

### Individual card export

Required:

- PNG
- JPG
- High-resolution print-ready front
- Exact 2.5 × 3.5 inch card proportion
- Configurable DPI, with a sensible print preset
- Bleed on/off
- Safe-area overlay preview only (not burned into export unless requested)
- Optional crop marks where appropriate
- File naming based on card/set/collector number

Later:

- Single-card PDF
- Printer-service presets
- Batch export every card in a project
- Front/back paired export with custom proxy backs

### Proxy sheet export

Required:

- US Letter and A4
- Nine-card layout where dimensions permit
- Quantity per card
- Mixed-card sheets
- Cut guides
- Bleed/no-bleed modes
- PDF output

Later:

- Automatic packing around duplicate counts
- Duplex custom-back alignment
- Printer calibration offsets

## Project system

Single-card projects use an `.sbsproxy.json`-compatible JSON structure initially. The eventual project format should support:

- Project/set name
- Many cards
- Saved set symbols
- Shared custom back
- Shared export settings
- Per-card artwork/crop metadata
- Versioned schema for forward migration

Desktop builds should eventually package project data and images so users do not lose work when source image files move.

## Proxy/counterfeit safeguards

- Never ship the official Magic card back.
- Default footer identifies the result as a proxy/playtest card.
- Users may create custom backs or use plain backs.
- Official card data may be imported for convenience, but rendering uses non-official proxy frames by default.
- Do not market output as authentic cards.

## Technical architecture

### UI/editor

- React 19
- TypeScript
- Vite
- Responsive editor with desktop-first two-pane layout

### Desktop

Use Electron initially to match the existing SaltyBananaSlug MTG Deck Editor packaging pipeline and reduce project/tooling duplication. A later migration to Tauri remains possible if package size becomes worth the maintenance cost.

### Rendering

Phase 1 preview: DOM/CSS renderer.

Phase 2 export: dedicated high-resolution canvas renderer so exported pixels do not depend on browser screenshot quirks. Keep layout geometry in reusable constants so preview and export remain visually aligned.

### PDF sheets

Use a deterministic PDF-generation layer fed by rendered card-front images. Card placement must use physical dimensions rather than guessed CSS pixels.

## Milestones

### M0 — Foundation (current branch)

- Standalone package
- Card schema
- Live card editor
- Initial frame variants
- Artwork upload
- Set-symbol upload
- Scryfall search/import
- Project save

### M1 — Real single-card export

- Canvas renderer
- High-resolution PNG/JPG
- 2.5 × 3.5 proportion
- 300/600 DPI presets
- Bleed/safe-zone preview
- Art crop/zoom controls

### M2 — Proxy sheets

- Multi-card tray
- Quantities
- Letter/A4 PDF generation
- Nine-card sheets
- Cut guides

### M3 — Projects and sets

- Open/save multi-card `.sbsproxy` projects
- Set symbol library
- Batch export
- Reorder/duplicate cards
- Autosave/recovery

### M4 — Desktop release

- Electron shell
- Windows portable build
- Native open/save dialogs
- Local Scryfall cache/network bridge
- Release packaging/checksums

### M5 — Advanced layouts

- Double-faced cards
- Planeswalkers/battles/sagas
- Split/adventure layouts
- Custom proxy backs
- Additional SaltyBananaSlug frame packs

### M6 — Integration

- “Make Proxy” action from SaltyBananaSlug's MTG Deck Editor
- Pass exact Scryfall printing into Proxy Builder
- Optional deck-to-proxy-project import
