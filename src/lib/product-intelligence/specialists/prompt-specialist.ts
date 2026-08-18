import "server-only";
import { classifyAndEnhancePrompt } from "@/lib/orchestration/prompt-intelligence";
import type { GenerationType, WorkflowType } from "@/lib/orchestration/types";

/**
 * Prompt Specialist (Phase 17).
 *
 * Wraps the EXISTING classifyAndEnhancePrompt() (Cloudflare Workers AI,
 * already used standalone via /api/orchestration/enhance-prompt) rather than
 * adding a second LLM call or a new paid service. Best-effort and AI-
 * assisted: its suggestion is untrusted, schema-shaped output that the
 * Manifest Compiler treats as the LOWEST-precedence signal (below explicit
 * user choice) and never as authoritative — see manifest-compiler.ts. Never
 * throws; unavailability degrades to a passthrough result, matching the
 * underlying function's own contract.
 */

export interface PromptSpecialistResult {
  enhancedPrompt: string;
  suggestedWorkflow: WorkflowType | null;
  applied: boolean;
}

export async function runPromptSpecialist(params: {
  prompt: string;
  generationType: GenerationType;
}): Promise<PromptSpecialistResult> {
  const result = await classifyAndEnhancePrompt(params);
  return {
    enhancedPrompt: result.enhancedPrompt,
    suggestedWorkflow: result.suggestedWorkflow,
    applied: result.classificationApplied,
  };
}
