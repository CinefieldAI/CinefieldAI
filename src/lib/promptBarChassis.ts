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
  boxShadow: [
    "inset 0 0 0 1.5px #141414",
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
  boxShadow: [
    "inset 0 0 0 1.5px #141414",
    "inset 0 1px 0 rgba(255,255,255,0.08)",
    "inset 0 -1px 0 rgba(0,0,0,0.55)",
    "inset 0 0 0 1px rgba(0,0,0,0.35)",
    "inset 0 10px 18px -12px rgba(0,0,0,0.55)",
    "0 14px 30px rgba(0,0,0,0.55)",
    "0 1px 0 rgba(255,255,255,0.02)",
  ].join(", "),
};

/** Compact near-black outer chassis. Use this on the bar element that frames
 * the prompt surface and sibling controls; do not use it as a mere border. */
export const PROMPT_BAR_OUTER_SHELL: CSSProperties = {
  background: "#141414",
  boxShadow: [
    "inset 0 0 0 1px rgba(255,255,255,0.025)",
    "inset 0 1px 0 rgba(255,255,255,0.025)",
    "0 12px 26px rgba(0,0,0,0.45)",
  ].join(", "),
};

/** Lighter dark-gray inner prompt surface. Keep this scoped to the actual
 * prompt/reference area so it cannot become a wide slab behind side controls. */
export const PROMPT_BAR_INNER_SURFACE: CSSProperties = {
  background:
    "linear-gradient(180deg, #2D2E2F 0%, #292A2B 55%, #262728 100%)",
  boxShadow: [
    "inset 0 1px 0 rgba(255,255,255,0.025)",
    "inset 0 -4px 8px rgba(0,0,0,0.18)",
  ].join(", "),
};

/** Flat near-black frame (3–4px reveal) that sits between the outer chassis
 * and the lighter prompt surface — e.g. wrapping Reference Video, or as the
 * `border` on a prompt textarea box (with `backgroundClip: "padding-box"` so
 * the gradient surface never bleeds under it). Distinct from the chassis
 * itself so the two near-black tones don't visually fuse into one slab. */
export const PROMPT_BAR_FRAME_DARK: CSSProperties = {
  background: "#1b1c1d",
};

/**
 * Three-layer recessed construction for the Audio Reference Video section
 * (Voiceover / Change Voice / Translate only) — a darker near-black channel
 * machined into the main chassis, with the Reference Video panel sitting
 * inside it slightly lighter than the channel.
 */
export const PROMPT_BAR_CAVITY_SURFACE: CSSProperties = {
  background: "linear-gradient(180deg, #171819 0%, #121314 55%, #0e0f10 100%)",
  boxShadow: [
    "inset 0 0 0 1px rgba(255,255,255,0.035)",
    "inset 0 1px 0 rgba(255,255,255,0.025)",
    "inset 0 -8px 16px rgba(0,0,0,0.32)",
    "0 1px 0 rgba(255,255,255,0.015)",
  ].join(", "),
};

export const PROMPT_BAR_PANEL_SURFACE: CSSProperties = {
  background: "linear-gradient(180deg, #303132 0%, #2b2c2d 55%, #272829 100%)",
  boxShadow: [
    "inset 0 1px 0 rgba(255,255,255,0.025)",
    "inset 0 -5px 10px rgba(0,0,0,0.18)",
  ].join(", "),
};
