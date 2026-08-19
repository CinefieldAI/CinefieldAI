import type { EvalCase, TaskType } from "./eval-contract";
import { CASE_KEY_PATTERN, EVAL_SET_KEY_PATTERN } from "./eval-contract";

/**
 * Cinefield golden evaluation dataset (Phase 22-A).
 *
 * ---------------------------------------------------------------------------
 * SOURCE-CONTROLLED, NOT A DATABASE TABLE
 * ---------------------------------------------------------------------------
 * The roadmap's own "Nasıl yapılacak" step 1 asks for "temsilî prompt ve
 * reference/criteria setleri" — representative fixtures, not real user data.
 * Keeping the actual case content here, in a reviewable TypeScript module,
 * satisfies "versioned, reproducible, reviewable, bounded" more directly
 * than a migration would: a new or changed case is a normal PR diff, and
 * `git blame`/`git log` ARE its version history. `model_eval_runs`/
 * `model_eval_results` (20260908000000_model_eval.sql) reference a case only
 * by its `caseKey` string — this file is the one place that key resolves to
 * an actual prompt.
 *
 * ---------------------------------------------------------------------------
 * SYNTHETIC, NEVER A REAL USER'S PROMPT
 * ---------------------------------------------------------------------------
 * Every prompt below is invented for this fixture. None is copied from a
 * real generation, a real user, or any production table — matching the
 * sensitive-data boundary every other eval file in this batch holds to.
 */

export const GOLDEN_EVAL_SET_KEY = "cinefield-golden-v1";

export const GOLDEN_EVAL_CASES: readonly EvalCase[] = [
  {
    caseKey: "image-product-shot-01",
    evalSetKey: GOLDEN_EVAL_SET_KEY,
    taskType: "image",
    prompt: "A ceramic coffee mug on a white marble countertop, soft morning light from the left, shallow depth of field.",
    criteria: { mustNotContain: ["watermark", "text overlay"], maxLatencyMs: 30_000 },
  },
  {
    caseKey: "image-character-portrait-01",
    evalSetKey: GOLDEN_EVAL_SET_KEY,
    taskType: "image",
    prompt: "A weathered lighthouse keeper in a wool coat, looking out over a stormy sea, cinematic lighting.",
    criteria: { mustNotContain: ["extra limbs", "distorted face"], maxLatencyMs: 30_000 },
  },
  {
    caseKey: "image-landscape-01",
    evalSetKey: GOLDEN_EVAL_SET_KEY,
    taskType: "image",
    prompt: "Terraced rice fields at sunrise, mist in the valleys, wide angle, no people.",
    criteria: { mustNotContain: ["people", "buildings"], maxLatencyMs: 30_000 },
  },
  {
    caseKey: "video-short-motion-01",
    evalSetKey: GOLDEN_EVAL_SET_KEY,
    taskType: "video",
    prompt: "A paper boat floating down a rain-soaked gutter, slow motion, top-down camera angle.",
    criteria: { maxLatencyMs: 120_000 },
  },
  {
    caseKey: "video-character-action-01",
    evalSetKey: GOLDEN_EVAL_SET_KEY,
    taskType: "video",
    prompt: "A chef tossing vegetables in a wok over an open flame, close-up, steam rising.",
    criteria: { maxLatencyMs: 120_000 },
  },
  {
    caseKey: "audio-narration-01",
    evalSetKey: GOLDEN_EVAL_SET_KEY,
    taskType: "audio",
    prompt: "A calm, measured narrator reading a two-sentence product description for a noise-cancelling headphone.",
    criteria: { mustNotContain: ["background music"], maxLatencyMs: 20_000 },
  },
  {
    caseKey: "audio-voice-emotion-01",
    evalSetKey: GOLDEN_EVAL_SET_KEY,
    taskType: "audio",
    prompt: "An excited voice announcing a limited-time sale, energetic but not shouting.",
    criteria: { maxLatencyMs: 20_000 },
  },
];

// Fails the module, the test run, and the build — never a request — the
// same discipline flag-registry.ts's own load-time check applies.
for (const c of GOLDEN_EVAL_CASES) {
  if (!CASE_KEY_PATTERN.test(c.caseKey)) throw new Error(`golden-dataset: "${c.caseKey}" does not match CASE_KEY_PATTERN`);
  if (!EVAL_SET_KEY_PATTERN.test(c.evalSetKey)) throw new Error(`golden-dataset: "${c.evalSetKey}" does not match EVAL_SET_KEY_PATTERN`);
  if (c.prompt.length === 0 || c.prompt.length > 500) throw new Error(`golden-dataset: "${c.caseKey}" prompt must be 1-500 chars`);
}

const CASE_KEYS = new Set(GOLDEN_EVAL_CASES.map((c) => c.caseKey));
if (CASE_KEYS.size !== GOLDEN_EVAL_CASES.length) {
  throw new Error("golden-dataset: duplicate caseKey");
}

export function goldenCasesFor(taskType: TaskType): readonly EvalCase[] {
  return GOLDEN_EVAL_CASES.filter((c) => c.taskType === taskType);
}

export function goldenCase(caseKey: string): EvalCase | null {
  return GOLDEN_EVAL_CASES.find((c) => c.caseKey === caseKey) ?? null;
}
