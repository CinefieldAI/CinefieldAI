/**
 * Cinefield blocked-model registry.
 *
 * These entries were originally carried into the UI under a competitor's
 * brand name (Higgsfield). They have been renamed to Cinefield and are
 * permanently BLOCKED from execution:
 *
 *  - They are competitor-branded product names, not models this project can
 *    legitimately ship or call.
 *  - None of them has a public API. They never executed — selecting one only
 *    ever produced a generations row stuck at "queued" forever.
 *
 * The lock is enforced at the single chokepoint every execution path goes
 * through (model-registry.ts's findModel), so no route, dev override, or
 * test can reach a provider with one of these. Do not remove the guard to
 * "just try it once" — that is exactly what it exists to prevent.
 *
 * This module is deliberately free of server-only imports so both the
 * browser and the server can use it.
 */

/** Prefix shown on every blocked model label in the UI. */
export const BLOCKED_MODEL_PREFIX = "🚫";

/**
 * Tailwind classes for a blocked model's label. The cyan matches the
 * existing bright accent already used elsewhere in the prompt surfaces
 * (#00e5ff), so this introduces no new colour into the design system.
 */
export const BLOCKED_MODEL_LABEL_CLASS = "text-[#00e5ff]";

/**
 * Canonical blocked ids. Matching is done on the id, lowercased — these are
 * the internal ids, which were deliberately left as-is so the existing
 * /assets/higgsfield/* files on disk keep resolving.
 */
const BLOCKED_ID_SUBSTRINGS = ["higgsfield", "cinefield-soul", "cinefield-lite"] as const;

/** True when a model label carries the blocked marker. Cheap enough for render paths. */
export function isBlockedModelLabel(label: string | null | undefined): boolean {
  return typeof label === "string" && label.trimStart().startsWith(BLOCKED_MODEL_PREFIX);
}

/**
 * True when a model id belongs to a blocked entry. Used by the registry
 * chokepoint; intentionally substring-based so a renamed or re-cased
 * variant cannot slip past it.
 */
export function isBlockedModelId(modelId: string | null | undefined): boolean {
  if (typeof modelId !== "string") return false;
  const normalized = modelId.trim().toLowerCase();
  return BLOCKED_ID_SUBSTRINGS.some((fragment) => normalized.includes(fragment));
}
