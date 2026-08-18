import "server-only";
import { isOrchestrationError, OrchestrationError } from "@/lib/orchestration/errors";
import { findModel, type ModelRegistryEntry } from "@/lib/orchestration/model-registry";
import { resolveWorkflow } from "@/lib/orchestration/workflow-router";
import { validateCapabilities } from "@/lib/orchestration/capability-validator";
import type { NormalizedGenerationInput, WorkflowType } from "@/lib/orchestration/types";
import type { UserIntent } from "../user-intent-contract";

/**
 * Capability Specialist (Phase 17).
 *
 * The one deterministic, non-AI specialist: it answers "can the requested
 * model actually do this?" by calling the EXISTING, canonical
 * validateCapabilities()/findModel()/resolveWorkflow() functions directly —
 * never reimplementing capability checking, never a second capability
 * source. This is the specialist justified by real product surfaces per the
 * Phase 17 reality audit (model-registry.ts / capability-validator.ts were
 * classified ALREADY_EXISTS, narrow scope).
 */

export type CapabilitySpecialistResult =
  | {
      outcome: "supported";
      model: ModelRegistryEntry;
      workflow: WorkflowType;
    }
  | {
      outcome: "unknown_model";
    }
  | {
      outcome: "unsupported";
      reasonCode: string;
    };

export function toReferenceInputs(intent: UserIntent): NormalizedGenerationInput[] {
  return intent.references.map((reference) => ({
    storagePath: reference.storagePath,
    mimeType: reference.mimeType,
    originalFileName: reference.storagePath,
    sizeBytes: 0,
    role: "reference" as const,
  }));
}

export function runCapabilitySpecialist(intent: UserIntent): CapabilitySpecialistResult {
  if (!intent.modelId) {
    return { outcome: "unsupported", reasonCode: "MODEL_ID_REQUIRED" };
  }

  const model = findModel(intent.modelId);
  if (!model) {
    return { outcome: "unknown_model" };
  }

  const inputs = toReferenceInputs(intent);

  try {
    const workflow = intent.workflow ?? resolveWorkflow(model, inputs);
    validateCapabilities({
      model,
      workflow,
      prompt: intent.prompt,
      inputs,
      settings: intent.settings,
    });
    return { outcome: "supported", model, workflow };
  } catch (caught) {
    if (isOrchestrationError(caught)) {
      return { outcome: "unsupported", reasonCode: caught.code };
    }
    return { outcome: "unsupported", reasonCode: (new OrchestrationError("INTERNAL_ERROR")).code };
  }
}
