import "server-only";
import type { UserIntent } from "./user-intent-contract";
import { runCapabilitySpecialist, type CapabilitySpecialistResult } from "./specialists/capability-specialist";
import { runPromptSpecialist, type PromptSpecialistResult } from "./specialists/prompt-specialist";
import { runSafetySpecialist, type SafetySpecialistResult } from "./specialists/safety-specialist";

/**
 * Core Coordinator (Phase 17).
 *
 * Deterministic composition only — NOT a workflow engine. It calls each
 * justified Specialist Director exactly once per intent, combines their
 * results into one CoordinatorResult, and hands that to the Manifest
 * Compiler. It owns no retry policy, no scheduling, no durable state, and no
 * generation lifecycle — all of that remains Temporal's alone (binding
 * ownership rule, Phase 17 brief).
 *
 * Only the specialists justified by the Phase 17 reality audit are wired
 * here: Capability (deterministic, always run), Prompt (AI-assisted, best-
 * effort), Safety (AI-assisted, fail-closed). No "Camera Director"/"Style
 * Director"/etc. — those would require a canonical control capability
 * source that the audit confirmed does not exist yet (Control/Panel Schema
 * Registry: MISSING). Inventing them now would mean validating against
 * nothing, which is exactly the fabricated-capability failure mode Section
 * 15 of the brief forbids.
 */

export interface CoordinatorResult {
  intent: UserIntent;
  capability: CapabilitySpecialistResult;
  prompt: PromptSpecialistResult;
  safety: SafetySpecialistResult;
}

export async function coordinateUserIntent(intent: UserIntent): Promise<CoordinatorResult> {
  // Deterministic, synchronous, and cheap — runs first so a hard capability
  // failure is known before spending an AI call on a request that cannot
  // proceed regardless of what the specialists say.
  const capability = runCapabilitySpecialist(intent);

  // Independent of each other and of the capability outcome — both examine
  // only the prompt text — so they run concurrently rather than serially.
  const [prompt, safety] = await Promise.all([
    runPromptSpecialist({ prompt: intent.prompt, generationType: intent.generationType }),
    runSafetySpecialist(intent.prompt),
  ]);

  return { intent, capability, prompt, safety };
}
