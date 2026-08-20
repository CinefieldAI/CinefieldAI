import "server-only";
import type { ClassifierVerdict, SafetyRiskCategory } from "./safety-contract";

/**
 * The prompt moderation engine seam (Phase 28-A).
 *
 * ---------------------------------------------------------------------------
 * A SHAPE, NOT AN ENGINE — THE SAME DISCIPLINE AS PHASE 9-E
 * ---------------------------------------------------------------------------
 * `src/lib/media/moderation-contract.ts` established the pattern for output
 * moderation: name what a classifier must answer, register nothing, default to
 * `null`, and let "no engine" be structurally distinguishable from "engine
 * said fine". This file is that pattern applied to gate B.
 *
 * It selects no provider, holds no credential, and makes no network call.
 * Choosing between Hive, AWS Rekognition, OpenAI moderation or anything else
 * is a cost and contract decision, and an implementation batch that quietly
 * signed Cinefield up for one would be making that decision on the owner's
 * behalf.
 *
 * ---------------------------------------------------------------------------
 * A WORD LIST IS NOT A MODERATION ENGINE
 * ---------------------------------------------------------------------------
 * REFERANS M.1 is explicit about gate B: "Kelime listesi yetmez; moderasyon
 * modeli kullan." So this file does NOT ship a keyword matcher dressed up as
 * a classifier. A regex over a banned-word list would produce a number that
 * looks like moderation on a dashboard while missing every paraphrase, and —
 * worse — its failures would be silent. `null` is the honest state until a
 * real model is wired.
 *
 * ---------------------------------------------------------------------------
 * THE CLIENT NEVER CHOOSES
 * ---------------------------------------------------------------------------
 * The engine is resolved from server environment only. There is no parameter,
 * header, or request field anywhere in this package through which a caller can
 * name an engine, disable one, or pass a threshold — the same reason
 * `generation-create-service.ts` re-derives the provider rather than accepting
 * one.
 */

export interface PromptModerationInput {
  /** The user's prompt. Passed to the classifier; NEVER persisted by this package. */
  readonly prompt: string;
  readonly negativePrompt: string | null;
  /**
   * Whether the request carries a user-supplied reference input.
   *
   * REFERANS M.1: "referans görsel yükleme EN RİSKLİ özelliktir (kullanıcı
   * gerçek bir insanın fotoğrafını yükleyebilir) — orayı en sıkı tut." A
   * classifier is told so it can weigh a real-person/NCII prompt differently
   * when a face may accompany it.
   */
  readonly hasReferenceInput: boolean;
}

export interface PromptModerationResult {
  readonly verdict: ClassifierVerdict;
  /** Bounded categories. Empty on ALLOW. Never invented to fill the field. */
  readonly categories: readonly SafetyRiskCategory[];
  /** Short code, matching SAFETY_REASON_PATTERN. Never free text. */
  readonly reasonCode: string;
  /** The engine's own version, recorded so a decision can be re-examined. */
  readonly classifierVersion: string;
}

/**
 * What a real engine must implement.
 *
 * Returning `null` means "this engine produced no verdict" — an outage, a
 * timeout, a refusal to answer. Deliberately distinct from a `BLOCK`, which is
 * a conclusion the engine DID reach. The gate maps `null` to `UNAVAILABLE`, and
 * `UNAVAILABLE` is not permissive.
 */
export interface PromptModerationEngine {
  readonly name: string;
  classify(input: PromptModerationInput): Promise<PromptModerationResult | null>;
}

/**
 * The registry, empty on purpose — exactly like Phase 9-E's `ENGINES`.
 *
 * The consequence is visible and correct: in production no prompt can be
 * cleared, so `prompt-gate.ts` refuses. That is the roadmap's own posture
 * ("Moderasyon bir 'hook' değil, generation lifecycle'ının zorunlu kapısıdır")
 * rather than a gap papered over with a permissive default.
 */
const ENGINES: ReadonlyMap<string, PromptModerationEngine> = new Map();

/**
 * A runtime-installed engine.
 *
 * This is the seam a real integration uses (the way `setMediaProcessor`
 * installs the Phase 9-C processor from the worker) and the seam tests use to
 * prove gate behaviour without a paid vendor. It is module-scoped and
 * server-only; nothing reachable from a browser can call it.
 */
let installed: PromptModerationEngine | null = null;

/**
 * Installs an engine, or clears it with `null`.
 *
 * Deliberately NOT called anywhere in production wiring today: installing an
 * engine is what selecting a vendor means, and no vendor has been selected.
 */
export function installPromptModerationEngine(engine: PromptModerationEngine | null): void {
  installed = engine;
}

/**
 * The active engine, or null. Null is the honest answer today.
 *
 * An unknown name in the environment resolves to `null` rather than to a
 * permissive fallback — a typo in configuration must not become "moderation is
 * off but looks on", which is the same rule `getModerationEngine()` states.
 */
export function getPromptModerationEngine(): PromptModerationEngine | null {
  if (installed) return installed;
  const configured = process.env.CINEFIELD_PROMPT_MODERATION_ENGINE;
  if (!configured) return null;
  return ENGINES.get(configured) ?? null;
}

export function isPromptModerationConfigured(): boolean {
  return getPromptModerationEngine() !== null;
}
