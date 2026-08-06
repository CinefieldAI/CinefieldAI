import { OrchestrationError } from "./errors";
import type { ModelRegistryEntry } from "./model-registry";
import type { NormalizedGenerationInput, WorkflowType } from "./types";

/**
 * Cinefield workflow router.
 *
 * Deterministically resolves which workflow a request represents, based on
 * the model's generation type and the kinds of inputs attached. Ambiguous or
 * unsupported combinations raise a typed error instead of being guessed at.
 */

function categorizeMimeType(mimeType: string): "image" | "video" | "audio" | "other" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "other";
}

export function resolveWorkflow(
  model: ModelRegistryEntry,
  inputs: NormalizedGenerationInput[]
): WorkflowType {
  if (inputs.length > model.maxInputs) {
    throw new OrchestrationError("UNSUPPORTED_WORKFLOW", {
      context: { modelId: model.id, inputCount: inputs.length, maxInputs: model.maxInputs },
      userMessage: `This model accepts at most ${model.maxInputs} input file(s).`,
    });
  }

  const categories = new Set(inputs.map((input) => categorizeMimeType(input.mimeType)));

  if (categories.has("other")) {
    throw new OrchestrationError("UNSUPPORTED_INPUT_TYPE", {
      context: { modelId: model.id },
    });
  }

  // More than one media category in a single request is ambiguous — refuse
  // rather than picking one arbitrarily.
  if (categories.size > 1) {
    throw new OrchestrationError("UNSUPPORTED_WORKFLOW", {
      context: { modelId: model.id, categories: [...categories] },
      userMessage: "Mixing different media types in one request is not supported.",
    });
  }

  const inputCategory = categories.size === 1 ? [...categories][0] : null;

  let workflow: WorkflowType;

  switch (model.generationType) {
    case "image":
      workflow = inputCategory === "image" ? "image-to-image" : "text-to-image";
      if (inputCategory !== null && inputCategory !== "image") {
        throw new OrchestrationError("UNSUPPORTED_INPUT_TYPE", {
          context: { modelId: model.id, inputCategory },
        });
      }
      break;

    case "video":
      if (inputCategory === null) workflow = "text-to-video";
      else if (inputCategory === "image") workflow = "image-to-video";
      else if (inputCategory === "video") workflow = "video-to-video";
      else workflow = "audio-to-video";
      break;

    case "audio":
      if (inputCategory !== null) {
        throw new OrchestrationError("UNSUPPORTED_INPUT_TYPE", {
          context: { modelId: model.id, inputCategory },
        });
      }
      workflow = "text-to-audio";
      break;
  }

  if (!model.supportedWorkflows.includes(workflow)) {
    throw new OrchestrationError("UNSUPPORTED_WORKFLOW", {
      context: { modelId: model.id, workflow },
    });
  }

  return workflow;
}

/** Workflows that cannot run without at least one input file. */
const INPUT_REQUIRED_WORKFLOWS: ReadonlySet<WorkflowType> = new Set<WorkflowType>([
  "image-to-image",
  "image-to-video",
  "video-to-video",
  "audio-to-video",
  "image-upscale",
  "video-upscale",
  "background-remove",
  "lip-sync",
]);

export function requiresInput(workflow: WorkflowType): boolean {
  return INPUT_REQUIRED_WORKFLOWS.has(workflow);
}
