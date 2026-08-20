import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://saltybananaslug-mtg-deck-editor.saltybananaslug.chatgpt.site"),
  title: "SaltyBananaSlug's MTG Deck Editor",
  description: "Import Commander decks, evaluate proposed cards, and find smarter cuts with live Scryfall data.",
  icons: { icon: "/sbs-mark.svg", shortcut: "/sbs-mark.svg" },
  openGraph: { title: "SaltyBananaSlug's MTG Deck Editor", description: "Build the deck you meant to build.", type: "website", images: [{ url: "/og.png", width: 1732, height: 908, alt: "SaltyBananaSlug's MTG Deck Editor" }] },
  twitter: { card: "summary_large_image", title: "SaltyBananaSlug's MTG Deck Editor", description: "Live card data. Contextual swaps. Zero hive-mind nonsense.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
