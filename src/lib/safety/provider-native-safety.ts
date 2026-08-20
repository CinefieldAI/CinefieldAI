import "server-only";
import type { SafetyRiskCategory } from "./safety-contract";

/**
 * Provider-native safety signals, normalized (Phase 28, §7).
 *
 * ---------------------------------------------------------------------------
 * GATE A EXISTS. IT IS EVIDENCE, NOT A DECISION.
 * ---------------------------------------------------------------------------
 * REFERANS M.1 calls the provider's own moderation "Kapı A" and then says
 * exactly what to do with it: "GÜVENME: açık ağırlıklı modeller (SDXL, Wan)
 * daha gevşektir." So a provider signal is captured, normalized, persisted
 * next to Cinefield's verdict — and never allowed to BE Cinefield's verdict.
 *
 * Two rules follow, and both are enforced in `output-safety.ts` rather than
 * left to a caller's discipline:
 *
 *   A provider saying "flagged" must NOT be discarded. It cannot be the sole
 *   basis for a block either, because vendors differ wildly in strictness —
 *   so it downgrades an otherwise-clean output to human review.
 *
 *   A provider saying "clean" grants NOTHING. There is no code path in this
 *   package where an absent or negative provider flag can produce ALLOW.
 *
 * ---------------------------------------------------------------------------
 * ONE BOUNDED KEY, CARRIED ON metadata
 * ---------------------------------------------------------------------------
 * Adapters already build `NormalizedOutput.metadata`, and that object survives
 * `normalizeOutputs` into `ResolvedOutput`. Rather than widen the adapter
 * contract with a safety field every provider would have to implement, a
 * provider that HAS a native signal writes this one namespaced key and a
 * provider that has none writes nothing — which parses to `null`, meaning "no
 * signal", not "clean".
 *
 * The parser below is strict on purpose: adapter metadata is provider-derived
 * data, and an unvalidated shape here would be a channel through which a
 * provider response fragment could reach the decision store.
 */

export const PROVIDER_SAFETY_METADATA_KEY = "providerSafety";

export interface ProviderNativeSafetySignal {
  /** Which adapter observed it. Bounded identifier, never a URL or payload. */
  readonly provider: string;
  /** What the provider concluded about THIS output. */
  readonly flagged: boolean;
  /** Bounded category, when the provider names one. */
  readonly category: SafetyRiskCategory | null;
  /** Short code naming the provider field that carried it. */
  readonly reasonCode: string;
}

const IDENTIFIER = /^[a-z][a-z0-9_-]{1,64}$/;
const REASON = /^[a-z][a-z0-9_]{1,64}$/;

const KNOWN_CATEGORIES = new Set<string>([
  "csam",
  "ncii",
  "real_person",
  "deepfake",
  "sexual_content",
  "illegal_content",
  "violence",
  "self_harm",
  "unclassified",
]);

/**
 * Reads a provider signal out of one output's metadata.
 *
 * Returns `null` for absent OR malformed. Those are the same thing for this
 * function's purpose — in both cases no trustworthy provider signal exists —
 * and collapsing them avoids a "malformed" state that a caller might then
 * treat as informative. What must never collapse is `null` versus
 * `{ flagged: false }`: the first is silence, the second is a claim, and only
 * the second is persisted as provider evidence.
 */
export function readProviderNativeSafety(metadata: unknown): ProviderNativeSafetySignal | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const raw = (metadata as Record<string, unknown>)[PROVIDER_SAFETY_METADATA_KEY];
  if (typeof raw !== "object" || raw === null) return null;

  const candidate = raw as Record<string, unknown>;
  const provider = candidate.provider;
  const flagged = candidate.flagged;
  const reasonCode = candidate.reasonCode;
  const category = candidate.category;

  if (typeof provider !== "string" || !IDENTIFIER.test(provider)) return null;
  if (typeof flagged !== "boolean") return null;
  if (typeof reasonCode !== "string" || !REASON.test(reasonCode)) return null;

  const normalizedCategory =
    typeof category === "string" && KNOWN_CATEGORIES.has(category)
      ? (category as SafetyRiskCategory)
      : null;

  return { provider, flagged, category: normalizedCategory, reasonCode };
}

/**
 * Builds the metadata fragment an adapter attaches to one output.
 *
 * Exported so adapters construct the shape through one validated helper rather
 * than hand-writing an object literal that could drift from the parser. An
 * invalid input yields `{}` — an adapter cannot accidentally emit a signal
 * that parses as trustworthy.
 */
export function providerSafetyMetadata(signal: {
  provider: string;
  flagged: boolean;
  category?: SafetyRiskCategory | null;
  reasonCode: string;
}): Record<string, unknown> {
  if (!IDENTIFIER.test(signal.provider) || !REASON.test(signal.reasonCode)) return {};
  return {
    [PROVIDER_SAFETY_METADATA_KEY]: {
      provider: signal.provider,
      flagged: signal.flagged,
      category: signal.category ?? null,
      reasonCode: signal.reasonCode,
    },
  };
}
