import type { CSSProperties } from "react";

/**
 * Shared "precision-machined industrial hardware" surface treatment for
 * every prompt-bar / composer shell across the site (Cinema Studio video
 * and image bars, the Audio composer, the homepage create-image composer,
 * Marketing Studio's composer, etc). Visual-only: background/border/shadow,
 * never layout, sizing, or DOM structure. Spread into each bar's existing
 * inline `style` object; remove any flat `bg-[...]` className the bar used
 * before so this gradient shows through.
 */
export const PROMPT_BAR_SURFACE: CSSProperties = {
  background: "linear-gradient(180deg, #2E2E2E 0%, #2B2B2B 50%, #262626 100%)",
  border: "1px solid rgba(255,255,255,0.07)",
  boxShadow: [
    "inset 0 1px 0 rgba(255,255,255,0.08)",
    "inset 0 -1px 0 rgba(0,0,0,0.55)",
    "inset 0 0 0 1px rgba(0,0,0,0.35)",
    "inset 0 10px 18px -12px rgba(0,0,0,0.55)",
    "0 14px 30px rgba(0,0,0,0.55)",
    "0 1px 0 rgba(255,255,255,0.02)",
  ].join(", "),
};

/** Same treatment for surfaces already using a translucent (rgba) dark
 *  background rather than a flat hex — keeps the same alpha family so it
 *  still reads correctly over each page's own backdrop blur. */
export const PROMPT_BAR_SURFACE_TRANSLUCENT: CSSProperties = {
  background:
    "linear-gradient(180deg, rgba(46,46,46,0.96) 0%, rgba(43,43,43,0.96) 50%, rgba(38,38,38,0.96) 100%)",
  border: "1px solid rgba(255,255,255,0.07)",
  boxShadow: [
    "inset 0 1px 0 rgba(255,255,255,0.08)",
    "inset 0 -1px 0 rgba(0,0,0,0.55)",
    "inset 0 0 0 1px rgba(0,0,0,0.35)",
    "inset 0 10px 18px -12px rgba(0,0,0,0.55)",
    "0 14px 30px rgba(0,0,0,0.55)",
    "0 1px 0 rgba(255,255,255,0.02)",
  ].join(", "),
};

/**
 * Three-layer recessed construction for the Audio Reference Video section
 * (Voiceover / Change Voice / Translate only) — a darker near-black channel
 * machined into the main chassis, with the Reference Video panel sitting
 * inside it slightly lighter than the channel.
 */
export const PROMPT_BAR_CAVITY_SURFACE: CSSProperties = {
  background: "linear-gradient(180deg, #161616 0%, #101010 100%)",
  boxShadow: [
    "inset 0 2px 5px rgba(0,0,0,0.75)",
    "inset 0 -1px 0 rgba(255,255,255,0.03)",
    "inset 0 0 0 1px rgba(0,0,0,0.55)",
  ].join(", "),
};

export const PROMPT_BAR_PANEL_SURFACE: CSSProperties = {
  background: "linear-gradient(180deg, #282828 0%, #202020 100%)",
  border: "1px solid rgba(255,255,255,0.06)",
  boxShadow: [
    "inset 0 1px 0 rgba(255,255,255,0.06)",
    "inset 0 -8px 14px -10px rgba(0,0,0,0.55)",
  ].join(", "),
};
