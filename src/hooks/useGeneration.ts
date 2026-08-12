"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useClerkSupabaseClient } from "@/lib/supabase/useClerkSupabaseClient";
import type { GenerationInsertPayload, Project } from "@/types/database";
import { buildInputStoragePath } from "@/lib/storageUpload";
import {
  mapCinemaModeToGenerationType,
  deriveProviderFromModelId,
} from "@/lib/cinemaGenerationMapping";
import {
  isOrchestrationModel,
  isMockOrchestrationModel,
  getOrchestrationGenerationType,
  getOrchestrationProvider,
} from "@/lib/orchestration/orchestration-models";

/**
 * Shared client-side generation workflow.
 *
 * Owns the full request lifecycle that was previously embedded in
 * CinemaStudioWorkspace: resolve the active project, upload an optional
 * input file, insert the generations row, dispatch
 * POST /api/generate (canonical), observe the row while queued/processing, sign the
 * delivery URL, and surface typed loading/success/error state.
 *
 * Deliberately provider-neutral: routing is decided only by the
 * orchestration model registry (client descriptor). Pages with a legacy,
 * non-orchestration execution path (e.g. the Nano Banana Gemini endpoint on
 * /generate) pass it in via `executeLegacy` — provider-specific logic never
 * lives here.
 *
 * The prompt is passed through verbatim — never trimmed beyond whitespace,
 * never rewritten — so TTS text reaches the server byte-for-byte.
 */

export type GenerationFlowStatus =
  | "idle"
  | "uploading"
  | "queued"
  | "processing"
  | "success"
  | "error";

export type GenerationResultType = "image" | "video" | "audio";

export interface GenerationResult {
  url: string;
  type: GenerationResultType;
}

/** Outcome of a page-supplied legacy executor (non-orchestration models). */
export type LegacyExecutionOutcome =
  | { ok: true; url: string | null; type: GenerationResultType; message: string }
  | { ok: false; error: string };

export interface GenerateRequest {
  /** Effective model id — the caller resolves picker state / dev overrides. */
  model: string;
  /** UI mode fallback used when the model is not an orchestration model. */
  uiMode: "image" | "video" | "audio";
  prompt: string;
  attachedFile?: File | null;
  /** Page-specific metadata (aspect_ratio, resolution, image_count, ...). */
  metadata?: Record<string, unknown>;
  /**
   * Optional legacy execution path for non-orchestration models. When
   * omitted, non-orchestration rows stay queued (the pre-existing default).
   */
  executeLegacy?: (generationId: string) => Promise<LegacyExecutionOutcome>;
}

interface GenerationTerminalRow {
  status: string;
  error_message: string | null;
  output_url: string | null;
  generation_type: string;
}

const TRIGGER_POLL_INTERVAL_MS = 1500;
const TRIGGER_POLL_MAX_ATTEMPTS = 40; // ~60s, generous headroom over provider timeouts

function toResultType(value: unknown): GenerationResultType {
  return value === "audio" || value === "video" ? value : "image";
}

/**
 * Trigger-mode dispatch only acknowledges the background job; the actual
 * run updates the same generations row via status-manager.ts. The browser
 * polls that row until a terminal status. `isCancelled` lets an unmounting
 * component stop the loop without leaking timers.
 */
async function pollGenerationUntilTerminal(
  supabase: SupabaseClient,
  generationId: string,
  isCancelled: () => boolean
): Promise<GenerationTerminalRow | null> {
  for (let attempt = 0; attempt < TRIGGER_POLL_MAX_ATTEMPTS; attempt++) {
    if (isCancelled()) return null;

    const { data } = await supabase
      .from("generations")
      .select("status, error_message, output_url, generation_type")
      .eq("id", generationId)
      .maybeSingle();

    // "cancelled" is terminal too. Omitting it meant a cancelled generation
    // polled until the attempt ceiling and then reported a timeout, which
    // told the user the wrong thing about their own action.
    if (
      data &&
      (data.status === "completed" || data.status === "failed" || data.status === "cancelled")
    ) {
      return data as GenerationTerminalRow;
    }

    await new Promise((resolve) => setTimeout(resolve, TRIGGER_POLL_INTERVAL_MS));
  }
  return null;
}

export interface UseGenerationOptions {
  /** Recorded into metadata.source_page for every row this hook creates. */
  sourcePage: string;
}

export function useGeneration({ sourcePage }: UseGenerationOptions) {
  const { user, isLoaded: userLoaded } = useUser();
  const { supabase, isSignedIn } = useClerkSupabaseClient();

  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<GenerationFlowStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const inFlightRef = useRef(false);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  // Auto-select the user's most recently created project — the same
  // convention every generation surface has used so far.
  useEffect(() => {
    if (!isSignedIn || !supabase) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1);

      if (cancelled) return;
      if (!error && data && data.length > 0) {
        setActiveProject(data[0] as Project);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isSignedIn, supabase]);

  /** State setters that no-op after unmount, so polling can't leak updates. */
  const safeSet = useCallback(
    (fn: () => void) => {
      if (!unmountedRef.current) fn();
    },
    []
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setMessage(null);
    setResult(null);
  }, []);

  const setError = useCallback((text: string) => {
    setStatus("error");
    setMessage(text);
  }, []);

  const generate = useCallback(
    async (request: GenerateRequest): Promise<void> => {
      // Duplicate-submission guard: one in-flight generation per hook.
      if (inFlightRef.current) return;

      if (!userLoaded || !user) {
        setError("Please sign in to generate.");
        return;
      }
      if (!supabase) {
        setError("Not connected. Please try again.");
        return;
      }
      if (!activeProject) {
        setError("No project available. Create a project first.");
        return;
      }

      const effectivePrompt = request.prompt.trim();
      const attachedFile = request.attachedFile ?? null;
      if (!effectivePrompt && !attachedFile) {
        setError("Enter a prompt or attach a file.");
        return;
      }

      inFlightRef.current = true;
      setIsGenerating(true);
      setStatus(attachedFile ? "uploading" : "queued");
      setMessage(null);

      let uploadedPath: string | null = null;

      try {
        const effectiveModel = request.model;
        const orchestrationType = getOrchestrationGenerationType(effectiveModel);
        const generationType =
          orchestrationType ?? mapCinemaModeToGenerationType(request.uiMode);
        const provider =
          getOrchestrationProvider(effectiveModel) ??
          deriveProviderFromModelId(effectiveModel);

        if (attachedFile) {
          const path = buildInputStoragePath(user.id, activeProject.id, attachedFile.name);
          const { error: uploadError } = await supabase.storage
            .from("generation-inputs")
            .upload(path, attachedFile, { cacheControl: "3600", upsert: false });

          if (uploadError) {
            setError(`Upload failed: ${uploadError.message}`);
            return;
          }
          uploadedPath = path;
          safeSet(() => setStatus("queued"));
        }

        const metadata: Record<string, unknown> = {
          ...(request.metadata ?? {}),
          source_page: sourcePage,
          ui_mode: request.uiMode,
        };
        if (attachedFile && uploadedPath) {
          metadata.original_file_name = attachedFile.name;
          metadata.file_size = attachedFile.size;
          metadata.mime_type = attachedFile.type;
          metadata.storage_bucket = "generation-inputs";
          metadata.storage_object_path = uploadedPath;
        }

        const payload: GenerationInsertPayload = {
          project_id: activeProject.id,
          generation_type: generationType,
          provider,
          model: effectiveModel,
          prompt: effectivePrompt,
          negative_prompt: null,
          input_url: uploadedPath,
          metadata,
        };

        const { data, error: insertError } = await supabase
          .from("generations")
          .insert([payload])
          .select()
          .single();

        if (insertError) {
          if (uploadedPath) {
            await supabase.storage.from("generation-inputs").remove([uploadedPath]);
          }
          setError(`Failed to queue generation: ${insertError.message}`);
          return;
        }

        const generationId = String(data.id);

        // ---- Orchestration pipeline (registry-listed models only) ----------
        if (isOrchestrationModel(effectiveModel)) {
          const usesMockProvider = isMockOrchestrationModel(effectiveModel);
          safeSet(() => {
            setStatus("processing");
            setMessage(null);
            setResult(null);
          });

          try {
            // The CANONICAL generation endpoint (Phase 5 convergence).
            const execResponse = await fetch("/api/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ generationId }),
            });
            const execJson = await execResponse.json();

            const successMessage = usesMockProvider
              ? "Cinefield mock orchestration test completed. No real AI provider was used."
              : "Generation completed.";

            if (!execResponse.ok) {
              safeSet(() =>
                setError(
                  typeof execJson.error === "string" ? execJson.error : "Generation failed."
                )
              );
            } else if (execJson.status === "queued" || execJson.status === "processing") {
              // ACCEPTED, NOT FAILED.
              //
              // This branch used to require `mode === "trigger"`, which was
              // the transport leaking into the client: any other owner
              // returning a perfectly healthy queued generation fell through
              // to the failure branch below. Enabling Temporal ownership
              // would have shown an error for a generation that succeeded.
              // Now the client branches on `status` alone and does not care
              // who is carrying the work.
              const finalRow = await pollGenerationUntilTerminal(
                supabase,
                generationId,
                () => unmountedRef.current
              );
              if (unmountedRef.current) return;

              if (!finalRow) {
                setError("Generation timed out. Please check back shortly.");
              } else if (finalRow.status === "cancelled") {
                // A cancellation is a legitimate outcome, not a failure.
                safeSet(() => {
                  setStatus("idle");
                  setMessage("Generation cancelled.");
                  setResult(null);
                });
              } else if (finalRow.status !== "completed") {
                setError(finalRow.error_message ?? "Generation failed.");
              } else {
                let signedUrl: string | null = null;
                if (finalRow.output_url) {
                  const { data: signedData } = await supabase.storage
                    .from("generation-outputs")
                    .createSignedUrl(finalRow.output_url, 3600);
                  signedUrl = signedData?.signedUrl ?? null;
                }
                safeSet(() => {
                  setStatus("success");
                  setMessage(successMessage);
                  setResult(
                    signedUrl
                      ? { url: signedUrl, type: toResultType(finalRow.generation_type) }
                      : null
                  );
                });
              }
            } else if (execJson.status === "cancelled") {
              safeSet(() => {
                setStatus("idle");
                setMessage("Generation cancelled.");
                setResult(null);
              });
            } else if (execJson.status !== "completed") {
              safeSet(() =>
                setError(
                  typeof execJson.error === "string" ? execJson.error : "Generation failed."
                )
              );
            } else {
              const firstOutput = Array.isArray(execJson.outputs) ? execJson.outputs[0] : null;
              safeSet(() => {
                setStatus("success");
                setMessage(successMessage);
                setResult(
                  firstOutput && typeof firstOutput.signedUrl === "string"
                    ? { url: firstOutput.signedUrl, type: toResultType(firstOutput.type) }
                    : null
                );
              });
            }
          } catch {
            safeSet(() => setError("Generation failed. Please try again."));
          }
          return;
        }

        // ---- Page-supplied legacy execution path ---------------------------
        if (request.executeLegacy) {
          safeSet(() => {
            setStatus("processing");
            setMessage(null);
            setResult(null);
          });

          try {
            const outcome = await request.executeLegacy(generationId);
            if (unmountedRef.current) return;

            if (!outcome.ok) {
              setError(outcome.error);
            } else {
              setStatus("success");
              setMessage(outcome.message);
              setResult(outcome.url ? { url: outcome.url, type: outcome.type } : null);
            }
          } catch {
            safeSet(() => setError("Generation failed. Please try again."));
          }
          return;
        }

        // ---- No execution path: row stays queued (pre-existing default) ----
        safeSet(() => {
          setStatus("success");
          setMessage(`Generation queued (${generationId.slice(0, 8)}...)`);
        });
      } catch (error) {
        safeSet(() =>
          setError(error instanceof Error ? error.message : "Failed to queue generation")
        );
      } finally {
        inFlightRef.current = false;
        safeSet(() => setIsGenerating(false));
      }
    },
    [userLoaded, user, supabase, activeProject, sourcePage, safeSet, setError]
  );

  return {
    // flow state
    status,
    message,
    result,
    isGenerating,
    // context
    activeProject,
    user,
    userLoaded,
    supabase,
    isSignedIn,
    // actions
    generate,
    reset,
    setError,
  };
}
