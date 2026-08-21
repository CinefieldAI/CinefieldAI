import { Space_Grotesk } from "next/font/google";

// "font-grotesk" shows up as a className across the Explore page components
// (copied along with the reference site's own markup) but was never actually
// wired to a loaded font — Tailwind silently drops it since no --font-grotesk
// token exists, so those headings were rendering in the default Geist Sans.
// Loaded locally (not in the root layout) to avoid colliding with another
// session's in-progress edits there.
export const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["700"],
  style: ["normal"],
});
