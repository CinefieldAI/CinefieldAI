import { OrchestrationError } from "./errors";
import type { ModelRegistryEntry } from "./model-registry";
import { requiresInput } from "./workflow-router";
import type { GenerationSettings, NormalizedGenerationInput, WorkflowType } from "./types";

/**
 * Cinefield capability validator.
 *
 * Re-validates everything server-side. The browser may show its own
 * validation for UX, but nothing it sends is trusted here.
 */

export function validateCapabilities(params: {
  model: ModelRegistryEntry;
  workflow: WorkflowType;
  prompt: string;
  inputs: NormalizedGenerationInput[];
  settings: GenerationSettings;
}): void {
  const { model, workflow, prompt, inputs, settings } = params;

  if (!model.enabled) {
    throw new OrchestrationError("MODEL_DISABLED", { context: { modelId: model.id } });
  }

  if (!model.supportedWorkflows.includes(workflow)) {
    throw new OrchestrationError("UNSUPPORTED_WORKFLOW", {
      context: { modelId: model.id, workflow },
    });
  }

  // ---- Prompt ----
  const trimmedPrompt = prompt.trim();
  if (model.capabilities.requiresPrompt && trimmedPrompt.length === 0) {
    throw new OrchestrationError("INVALID_INPUT", {
      context: { modelId: model.id },
      userMessage: "A prompt is required for this model.",
    });
  }
  if (
    model.capabilities.maxPromptLength !== undefined &&
    trimmedPrompt.length > model.capabilities.maxPromptLength
  ) {
    throw new OrchestrationError("INVALID_INPUT", {
      context: { modelId: model.id, promptLength: trimmedPrompt.length },
      userMessage: `The prompt exceeds the ${model.capabilities.maxPromptLength} character limit.`,
    });
  }

  // ---- Inputs ----
  if (requiresInput(workflow) && inputs.length === 0) {
    throw new OrchestrationError("REQUIRED_INPUT_MISSING", {
      context: { modelId: model.id, workflow },
    });
  }
  if (inputs.length > model.maxInputs) {
    throw new OrchestrationError("UNSUPPORTED_WORKFLOW", {
      context: { modelId: model.id, inputCount: inputs.length, maxInputs: model.maxInputs },
      userMessage: `This model accepts at most ${model.maxInputs} input file(s).`,
    });
  }
  for (const input of inputs) {
    if (!model.acceptedInputMimeTypes.includes(input.mimeType)) {
      throw new OrchestrationError("UNSUPPORTED_INPUT_TYPE", {
        context: { modelId: model.id, mimeType: input.mimeType },
      });
    }
  }

  // ---- Settings ----
  const { capabilities } = model;

  if (settings.aspectRatio !== undefined) {
    if (!capabilities.supportedAspectRatios.includes(settings.aspectRatio)) {
      throw new OrchestrationError("CAPABILITY_NOT_SUPPORTED", {
        context: { modelId: model.id, aspectRatio: settings.aspectRatio },
        userMessage: `Aspect ratio ${settings.aspectRatio} is not supported by this model.`,
      });
    }
  }

  if (settings.resolution !== undefined) {
    if (!capabilities.supportedResolutions.includes(settings.resolution)) {
      throw new OrchestrationError("CAPABILITY_NOT_SUPPORTED", {
        context: { modelId: model.id, resolution: settings.resolution },
        userMessage: `Resolution ${settings.resolution} is not supported by this model.`,
      });
    }
  }

  if (settings.durationSeconds !== undefined) {
    if (!capabilities.supportedDurationsSeconds.includes(settings.durationSeconds)) {
      throw new OrchestrationError("CAPABILITY_NOT_SUPPORTED", {
        context: { modelId: model.id, durationSeconds: settings.durationSeconds },
        userMessage: `Duration ${settings.durationSeconds}s is not supported by this model.`,
      });
    }
  }

  if (settings.outputCount !== undefined) {
    const { minOutputCount, maxOutputCount } = capabilities;
    if (
      !Number.isInteger(settings.outputCount) ||
      settings.outputCount < minOutputCount ||
      settings.outputCount > maxOutputCount
    ) {
      throw new OrchestrationError("CAPABILITY_NOT_SUPPORTED", {
        context: { modelId: model.id, outputCount: settings.outputCount },
        userMessage: `This model supports between ${minOutputCount} and ${maxOutputCount} outputs.`,
      });
    }
  }

  if (settings.thinking !== undefined) {
    if (!capabilities.supportsThinking) {
      throw new OrchestrationError("CAPABILITY_NOT_SUPPORTED", {
        context: { modelId: model.id },
        userMessage: "This model does not support the Thinking setting.",
      });
    }
    if (!capabilities.supportedThinkingValues.includes(settings.thinking)) {
      throw new OrchestrationError("CAPABILITY_NOT_SUPPORTED", {
        context: { modelId: model.id, thinking: settings.thinking },
        userMessage: `Thinking value "${settings.thinking}" is not supported by this model.`,
      });
    }
  }

  if (settings.seed !== undefined && !Number.isInteger(settings.seed)) {
    throw new OrchestrationError("INVALID_INPUT", {
      context: { modelId: model.id },
      userMessage: "Seed must be an integer.",
    });
  }

  // ---- Audio (text-to-speech and future audio workflows) ----
  if (capabilities.requiresVoice && !settings.voice) {
    throw new OrchestrationError("REQUIRED_INPUT_MISSING", {
      context: { modelId: model.id },
      userMessage: "A voice is required for this model.",
    });
  }

  if (settings.language !== undefined && capabilities.supportedLanguages) {
    const allowsAny = capabilities.supportedLanguages.includes("any");
    if (!allowsAny && !capabilities.supportedLanguages.includes(settings.language)) {
      throw new OrchestrationError("CAPABILITY_NOT_SUPPORTED", {
        context: { modelId: model.id, language: settings.language },
        userMessage: `Language "${settings.language}" is not supported by this model.`,
      });
    }
  }
}
