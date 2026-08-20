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
  isProductionReadyModel,
} from "@/lib/orchestration/orchestration-models";
import {
  canOfferForGeneration,
  fetchModelAvailability,
  resolveRuntimeAvailability,
} from "@/lib/orchestration/model-availability-client";

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

        // ---- PHASE 8: the preselected-model guard -------------------------
        //
        // Blocking the picker row is not enough. A model can already BE the
        // selection — restored from state, carried by ?model=, or simply the
        // default — long before anyone opens the list, and its availability
        // can change while the page is open. Without this, Generate looks
        // perfectly normal and dies at the server with NO_ELIGIBLE_ROUTE.
        //
        // Awaits the shared cache rather than reading it: on the very first
        // click the fetch may still be in flight, and "not heard yet" must not
        // resolve as permission.
        //
        // This is UX consistency, NOT enforcement. POST /api/generate
        // re-derives eligibility itself, so a client that skipped this — or
        // lied about it — still cannot run an unsafe provider.
        if (isOrchestrationModel(effectiveModel)) {
          const runtime = await fetchModelAvailability();
          const availability = resolveRuntimeAvailability(effectiveModel, {
            isServerModel: true,
            staticProductionReady: isProductionReadyModel(effectiveModel),
            runtime,
          });
          if (!canOfferForGeneration(availability)) {
            setError("This model is currently unavailable. Please choose another model.");
            return;
          }
        }

        const orchestrationType = getOrchestrationGenerationType(effectiveModel);
        const generationType =
          orchestrationType ?? mapCinemaModeToGenerationType(request.uiMode);
        // PHASE 7-F: the browser no longer holds an opinion about which
        // provider runs an orchestration model — the server's router decides,
        // and the client module that used to answer this no longer can. This
        // value is used ONLY by the legacy placeholder insert below, for model
        // ids the server registry does not know and that therefore never
        // reach the production generation path at all.
        const legacyPlaceholderProvider = deriveProviderFromModelId(effectiveModel);

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

        // ---- Non-orchestration models: unchanged placeholder path ----------
        //
        // These model ids are not in the server registry, so they have no
        // provider, no adapter and no way to execute — today they insert an
        // inert "queued" row that nothing ever picks up, and a page may
        // supply its own executeLegacy for it. That path is NOT the canonical
        // production generation path and never reaches the server generation
        // boundary; routing it through /api/generate would only turn a
        // harmless placeholder into a hard UNKNOWN_MODEL error on a frozen
        // UI. It stays exactly as it was, and is reported as the one
        // remaining browser insert.
        if (!isOrchestrationModel(effectiveModel)) {
          const placeholder: GenerationInsertPayload = {
            project_id: activeProject.id,
            generation_type: generationType,
            provider: legacyPlaceholderProvider,
            model: effectiveModel,
            prompt: effectivePrompt,
            negative_prompt: null,
            input_url: uploadedPath,
            metadata,
          };

          const { data, error: insertError } = await supabase
            .from("generations")
            .insert([placeholder])
            .select()
            .single();

          if (insertError) {
            if (uploadedPath) {
              await supabase.storage.from("generation-inputs").remove([uploadedPath]);
            }
            setError(`Failed to queue generation: ${insertError.message}`);
            return;
          }

          const placeholderId = String(data.id);

          if (request.executeLegacy) {
            safeSet(() => {
              setStatus("processing");
              setMessage(null);
              setResult(null);
            });
            try {
              const outcome = await request.executeLegacy(placeholderId);
              if (unmountedRef.current) return;
              if (!outcome.ok) setError(outcome.error);
              else {
                setStatus("success");
                setMessage(outcome.message);
                setResult(outcome.url ? { url: outcome.url, type: outcome.type } : null);
              }
            } catch {
              safeSet(() => setError("Generation failed. Please try again."));
            }
            return;
          }

          safeSet(() => {
            setStatus("success");
            setMessage(`Generation queued (${placeholderId.slice(0, 8)}...)`);
          });
          return;
        }

        // PHASE 5 FINAL CONVERGENCE — the row is created SERVER-SIDE.
        //
        // The browser used to insert it here under RLS and hand the id to the
        // server. That put the last piece of the production path on the wrong
        // side of the trust boundary: the client chose when a generation came
        // into existence, supplied its provider and generation_type, and two
        // clicks produced two rows before any server code ran.
        //
        // Now the client describes the request and the server derives the
        // rest. `provider` and `generationType` are still computed above for
        // the non-orchestration legacy branch further down; the canonical
        // path does not send them, and the server would ignore them if it
        // did — routing comes from the model registry.
        //
        // The idempotency key is per ATTEMPT-TO-SUBMIT, generated here, so a
        // double click or a retried fetch resolves to one generation instead
        // of two. It is bound server-side to the authenticated actor and to a
        // hash of this exact request.
        const idempotencyKey = `gen-${crypto.randomUUID()}`;

        const createResponse = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: effectiveModel,
            prompt: effectivePrompt,
            projectId: activeProject.id,
            negativePrompt: null,
            inputUrl: uploadedPath,
            metadata,
            idempotencyKey,
          }),
        });
        const createJson = await createResponse.json();

        if (!createResponse.ok) {
          if (uploadedPath) {
            await supabase.storage.from("generation-inputs").remove([uploadedPath]);
          }
          safeSet(() =>
            setError(
              typeof createJson.error === "string"
                ? createJson.error
                : "Failed to queue generation."
            )
          );
          return;
        }

        const generationId = String(createJson.generationId);

        // ---- Orchestration pipeline (registry-listed models only) ----------
        {
          const usesMockProvider = isMockOrchestrationModel(effectiveModel);
          safeSet(() => {
            setStatus("processing");
            setMessage(null);
            setResult(null);
          });

          try {
            // The canonical endpoint CREATED the generation and started its
            // workflow in one call, so its response is already the execution
            // response — there is no second request to make. Issuing one
            // would be a duplicate the server would have to deduplicate.
            const execResponse = createResponse;
            const execJson = createJson;

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
                // PHASE 27: the finished artifact is the C2PA-signed canonical
                // object in R2, which the browser cannot reach and cannot sign
                // for itself. `output_url` is now an R2 object key, not a
                // Supabase Storage path, so the URL is minted server-side by a
                // route that re-checks ownership and the Phase 9-E quarantine
                // gate immediately before signing.
                let signedUrl: string | null = null;
                if (finalRow.output_url) {
                  try {
                    const assetResponse = await fetch(
                      `/api/generations/${generationId}/asset-url`,
                      { cache: "no-store" }
                    );
                    if (assetResponse.ok) {
                      const assetJson = (await assetResponse.json()) as {
                        signedUrl?: string | null;
                      };
                      signedUrl = assetJson.signedUrl ?? null;
                    }
                  } catch {
                    // A URL that cannot be minted right now is "not
                    // deliverable yet", never a failed generation.
                    signedUrl = null;
                  }
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
