# Cinefield Architecture Contract

**Source of truth (original, unmodified, do not edit):** `CINEFIELD_ARCHITECTURE_CONTRACT_SOURCE.txt` (project root)
**Original title:** "HIGGSFIELD BENZERİ AI PLATFORMU — ANA MİMARİ SÖZLEŞMESİ" ("Higgsfield-like AI Platform — Master Architecture Contract")
**Original language:** Turkish. This document is a faithful English rendering of the source's architectural principles, reorganized around the same 47 numbered sections, for use by contributors and coding agents who need it in English. **If this document and the source `.txt` file ever disagree, the source `.txt` file is authoritative** — this file should be corrected to match it, not the other way around.
**Status:** This is the top-level technical architecture instruction for the project. Before adding a feature, connecting a provider, changing a database table, or refactoring existing code, the rules below should be consulted.

The goal is a Higgsfield-like, multi-model AI image/video platform — built independently, based only on observable product behavior, never by imitating another company's proprietary code, trade secrets, or unknown internals.

---

## CURRENT CINEFIELD IMPLEMENTATION OVERRIDES

**Read this section first.** The source contract (below) describes the intended long-term target architecture. Cinefield's actual implementation, as verified in the repository at commit `2c4e3db` (branch `main`), already exists and works for a real subset of that architecture. Where the source contract's abstractions and folder names differ from what is actually built and proven, **the current implementation wins** until a separate, reviewed migration phase says otherwise. Specifically:

- **Preserve the existing architecture under `src/lib/orchestration/`.** This is Cinefield's real, working implementation of the source contract's "Provider adapter" + "Model registry" + "Generation worker" layers (sections 4–8). It is not a placeholder to be replaced.
- **Do not create a second orchestration/provider system under `src/providers/`.** The source contract's example folder layout (`providers/fal/`, `providers/runway/`, …, section 6) is illustrative, not a literal instruction to add a second, competing directory. Cinefield's provider adapters already live under `src/lib/orchestration/providers/`.
- **Preserve the existing generic `ProviderAdapter`** (`src/lib/orchestration/providers/provider-adapter.ts`). It already matches the shape the source contract asks for in section 6 (`submit`/`getStatus`/`getResult`/`cancel`, i.e. the same intent as `createJob`/`getJobStatus`/`cancelJob`/`normalizeResult`). Do not replace it with a narrower, video-only, or single-provider-shaped adapter.
- **Use one reusable adapter per provider, not one adapter per model.** This already matches source section 6 exactly — `fal-provider.ts` serves every fal.ai model through the model registry, not one file per model.
- **Individual models must be mapped through the existing model registry** (`src/lib/orchestration/model-registry.ts`), matching source section 5's "model registry as single source of truth" principle. No parallel, hand-written model list may be introduced elsewhere.
- **Cloudflare AI Gateway is a gateway/control layer**, matching source section 24 exactly (prompt enhancement, vision analysis, moderation, rate limiting — never a video orchestrator).
- **Cloudflare Workers AI may be an actual provider** — a real inference backend, distinct from the AI Gateway that may sit in front of it. This is a refinement of source section 24 for planning purposes: "Cloudflare" is not one undifferentiated concept.
- **Record actual provider and optional gateway as separate concepts.** A generation's `provider` field (already: `"mock"`, `"fal"`) identifies who actually generated the output. A gateway (Cloudflare AI Gateway or otherwise) is routing/observability plumbing in front of a call, not the provider of record.
- **Never route Runway through the fal adapter. Never route fal.ai models through the Runway adapter.** Directly restates source section 44's "do not treat fal.ai and Runway as the same provider" and section 45 Faz 4's "Runway must not be added inside the fal.ai code." No Runway adapter exists yet (see Phase 8 in the roadmap) — this rule pre-commits to keeping it separate when it is built.
- **Supabase Storage is the currently verified storage system.** The private `generation-inputs` and `generation-outputs` buckets, with signed-URL delivery, are real and working today (Phases 2–4). The source contract's R2 folder structure (section 20) is target architecture for a *future* migration, not a description of what exists now.
- **Cloudflare R2 is a future migration phase** (see Phase 12 in the roadmap) and must not replace Supabase Storage without its own separate, reviewed phase. Supabase Storage is not a stand-in to be silently swapped out.
- **Do not change the current database schema to match future examples in the source contract.** Section 26's full example table list (`workspaces`, `scenes`, `shots`, `characters`, `credit_ledger`, `provider_jobs`, `webhook_events`, `community_posts`, …) is target architecture. The current schema has exactly three tables: `profiles`, `projects`, `generations` (verified directly against `supabase/migrations/20260805132704_remote_schema.sql`). Do not add columns or tables speculatively to "get ahead" of a future phase.
- **Do not persist API keys, authorization headers, signed URLs, temporary provider URLs, or raw provider responses.** This is already enforced today: `output_url` stores only a private storage path (never a signed URL), provider adapters never leak raw payloads past their own file, and secrets are read from server-only env vars. This restates source sections 6, 22, and 34 as a hard current-code invariant, not just a future goal.
- **Preserve mock-image, fal-flux-schnell, Trigger.dev, mock-tts, private Storage, polling, image rendering, and audio playback.** These are real, tested, working paths (see the Implementation Checkpoints below). No future phase may modify them except through its own additive, reviewed change.
- **New integrations must be additive and tested before replacing working paths.** No phase may remove or break an existing verified capability as a side effect of adding a new one. This restates source section 46's working method as a standing rule, not just an instruction for one agent session.

---

## 1. Core Architectural Rule

The project is not built from a single AI model or a single API connection. The system consists of independent layers, each with distinct responsibilities that must not be blurred together:

1. User interface
2. Authentication
3. Project and media management
4. Credit and subscription system
5. Generation API
6. Job queue / long-running task system
7. AI Director
8. Prompt compiler
9. Model registry
10. Provider router
11. Provider adapters
12. Generation worker
13. Webhook and polling system
14. File storage
15. Media processing
16. Security and moderation
17. Logging and observability
18. Community and sharing
19. MCP integration
20. Admin panel

**Current implementation note:** layers 1 (UI, Next.js App Router), 3 (projects/generations rows), 5 (`/api/orchestration/execute`), 6 (Trigger.dev), 9 (model registry), 11 (provider adapters), 12 (`executeGeneration`), and 14 (Supabase Storage) exist today for image and audio (text-to-speech). Layers 2 (Clerk) and parts of 16 exist for auth. The remaining layers (4, 7, 8 as a distinct module, 10 as a distinct module, 13 as webhooks specifically, 15, 17 beyond basic logs, 18, 19, 20) are target architecture, not yet built.

## 2. Target System Architecture

The source contract's diagram (preserved verbatim below; original Turkish labels) describes the eventual full request path: user → Next.js frontend → Clerk / upload → Next.js backend API → authorization/credit/input checks → Supabase → Trigger.dev → Cinema Worker → AI Director / Prompt Compiler / Asset Analyzer → Cloudflare AI Gateway → Provider Router → fal.ai / Runway / Google Veo / Kling / others → Webhook/Polling Manager → Result Normalizer → R2 / Supabase DB / FFmpeg → user result.

```
                        KULLANICI (USER)
                            │
                            ▼
                    Next.js Frontend
                            │
               ┌────────────┴────────────┐
               ▼                         ▼
             Clerk                 Upload sistemi
       Kimlik doğrulama            Signed URL
       (Authentication)
               │                         │
               └────────────┬────────────┘
                            ▼
                   Next.js Backend API
                            │
            ┌───────────────┼────────────────┐
            ▼               ▼                ▼
       Yetki kontrolü   Kredi kontrolü   Input doğrulama
       (Authorization)  (Credit check)   (Input validation)
            │               │                │
            └───────────────┼────────────────┘
                            ▼
                     Supabase Database
                            │
                    Generation kaydı
                    (Generation record)
                            │
                            ▼
                       Trigger.dev
                            │
                            ▼
                       Cinema Worker
                            │
       ┌────────────────────┼─────────────────────┐
       ▼                    ▼                     ▼
  AI Director         Prompt Compiler       Asset Analyzer
       │                    │                     │
       └────────────────────┼─────────────────────┘
                            ▼
                    Cloudflare AI Gateway
                            │
            ┌───────────────┼────────────────┐
            ▼               ▼                ▼
       Metin modeli     Vision modeli    Moderasyon
       (Text model)     (Vision model)   (Moderation)
                            │
                            ▼
                     Provider Router
                            │
       ┌────────────┬───────┼────────┬────────────┐
       ▼            ▼       ▼        ▼            ▼
     fal.ai       Runway   Google   Kling API   Diğerleri
                         Veo API                (Others)
       │            │       │        │            │
       └────────────┴───────┼────────┴────────────┘
                            ▼
                 Webhook / Polling Manager
                            │
                            ▼
                      Result Normalizer
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
             R2        Supabase DB       FFmpeg
              │             │             │
              └─────────────┼─────────────┘
                            ▼
                     Kullanıcı sonucu
                     (User result)
```

**Current implementation note:** today's real path for a completed generation is: browser → Supabase insert → `POST /api/orchestration/execute` (Clerk-authenticated) → direct execution or Trigger.dev dispatch (`GENERATION_EXECUTION_MODE`) → `executeGeneration()` (claim → normalize → route → validate → provider adapter `submit`/`getResult` → `normalizeOutputs` → upload to Supabase Storage → `markCompleted`) → signed URL minted only for the response → browser renders image or `<audio controls>`. There is no Cloudflare AI Gateway, no AI Director, no Prompt Compiler, no R2, and no FFmpeg in the current path — those are target architecture (Phases 5A–13).

## 3. Frontend Responsibility

The frontend manages user experience only: sign-in/sign-up, model selection, prompt input, reference upload, resolution/aspect-ratio/duration selection, camera and style settings, project creation, generation status display, result gallery, credit display, generation history, project sharing, and readable error messages.

The frontend must **never**: carry a provider API key, call fal.ai or Runway directly, compute credits, decide model pricing, choose a provider endpoint, block waiting on a long job, or trust a model id sent by the user.

The frontend must send only safe, limited parameters to the backend, e.g.:

```json
{
  "projectId": "project_123",
  "modelKey": "runway-image-to-video",
  "prompt": "A cinematic fashion scene",
  "aspectRatio": "16:9",
  "durationSeconds": 5,
  "assetIds": ["asset_456"]
}
```

The frontend must never send:

```json
{
  "providerEndpoint": "https://provider.example/generate",
  "providerApiKey": "...",
  "rawProviderModelId": "..."
}
```

**Current implementation note:** already true today — `CinemaStudioWorkspace.tsx` sends only `{generationId}` to `/api/orchestration/execute`; ownership, model, provider, and settings are resolved server-side from the database and the model registry, never trusted from the request body.

## 4. Model / Provider / Feature Are Three Distinct Concepts

- **Provider**: the company/platform offering the API (e.g. `fal`, `runway`, `google`, `replicate`, `cloudflare`, `openai`).
- **Model**: the actual AI model doing the generation (e.g. Veo, Kling, Seedance, Runway Gen, FLUX, Whisper, Llama, Qwen).
- **Feature / product mode**: the user-facing generation experience (e.g. Cinema Studio, Image-to-Video, Product Commercial, AI Director, Character Builder, Storyboard, Upscaler, Lip Sync, Camera Motion).

A feature is not the same as one model. Cinema Studio ≠ one video model — it is AI Director + prompt compiler + camera settings + character references + model selection + video generation + result processing, combined.

**Current implementation note:** the model registry already separates `id` (Cinefield-internal), `providerId`, and `providerModelId` per entry — the provider/model distinction is real today. "Feature" as its own composed layer (AI Director, prompt compiler) does not exist yet.

## 5. Model Registry Is the Single Source of Truth

Every supported model must be defined in one central registry, e.g.:

```ts
type ModelDefinition = {
  key: string;
  displayName: string;
  provider: string;
  providerModelId: string;
  adapter: string;

  capabilities: {
    textToImage: boolean;
    imageToImage: boolean;
    textToVideo: boolean;
    imageToVideo: boolean;
    videoToVideo: boolean;
    audio: boolean;
    lipSync: boolean;
  };

  limits: {
    durations?: number[];
    aspectRatios?: string[];
    maxReferenceImages?: number;
    maxPromptLength?: number;
    supportedResolutions?: string[];
  };

  pricing: {
    internalCreditCost: number;
    estimatedProviderCost?: number;
  };

  availability: {
    enabled: boolean;
    maintenanceMode: boolean;
    allowedPlans: string[];
  };
};
```

No hand-written, separate model lists may exist in the frontend. The model card, price, supported duration, resolution, and aspect ratios must all be derived from the same registry data.

**Current implementation note:** `src/lib/orchestration/model-registry.ts` already implements this principle with `ModelRegistryEntry`/`ModelCapabilities` — narrower in scope today (no `pricing`, `availability.allowedPlans`, or feature-flag fields yet, since credits/plans/feature-flags are not implemented), but structurally the same "one registry, one shape" idea. Extending it with pricing/availability fields is future work (Phase 7, Phase 9), not a reason to build a second registry now.

## 6. Provider Adapter Rule

Each provider must use its own adapter (illustrative layout from the source):

```
providers/
  fal/
  runway/
  google/
  kling/
  replicate/
  cloudflare/
```

Each adapter must expose the same standard operations:

```ts
interface GenerationProviderAdapter {
  validateInput(input: NormalizedGenerationInput): Promise<void>;
  createJob(input: NormalizedGenerationInput): Promise<ProviderJobResponse>;
  getJobStatus(externalJobId: string): Promise<ProviderJobStatus>;
  cancelJob?(externalJobId: string): Promise<void>;
  normalizeResult(rawResult: unknown): Promise<NormalizedGenerationResult>;
  normalizeError(error: unknown): NormalizedProviderError;
}
```

Provider-specific request/response types must never leak outside the adapter. No other part of the application should know fal.ai's or Runway's raw response format.

**Current implementation note (see also the override section above):** this is real today at `src/lib/orchestration/providers/provider-adapter.ts` (`ProviderAdapter`: `submit`/`getStatus`/`getResult`/`cancel`) and `src/lib/orchestration/providers/{mock,fal}-provider.ts`. The folder path differs from the source's illustrative `providers/fal/` (Cinefield uses `src/lib/orchestration/providers/fal-provider.ts`, one file per provider rather than one directory per provider) — this is an accepted, working variation, not a gap. Adapters already keep fal-specific shapes (e.g. `mapAspectRatioToFalImageSize`) private to their own file.

## 7. Normalized Generation Input

A common input shape must be built before any provider call:

```ts
type NormalizedGenerationInput = {
  generationId: string;
  userId: string;
  projectId: string;

  taskType:
    | "text-to-image"
    | "image-to-image"
    | "text-to-video"
    | "image-to-video"
    | "video-to-video"
    | "upscale"
    | "lip-sync";

  provider: string;
  modelKey: string;
  providerModelId: string;

  originalPrompt: string;
  enhancedPrompt?: string;
  negativePrompt?: string;

  inputAssets: Array<{
    assetId: string;
    url: string;
    type: "image" | "video" | "audio";
    role:
      | "start-frame"
      | "end-frame"
      | "character-reference"
      | "style-reference"
      | "source-video"
      | "audio";
  }>;

  settings: {
    aspectRatio?: string;
    resolution?: string;
    durationSeconds?: number;
    seed?: number;
    numberOfOutputs?: number;
    cameraMotion?: string;
    stylePreset?: string;
  };
};
```

Every provider adapter must convert this shared input into its own API format.

**Current implementation note:** `NormalizedGenerationRequest` in `src/lib/orchestration/types.ts` is Cinefield's real equivalent — `taskType` is called `workflow` (with its own `WorkflowType` union, now including `text-to-speech`), and `settings` already carries `voice`/`language` for audio in addition to the source's fields. `enhancedPrompt` does not exist yet (no prompt compiler/AI Director layer yet) — `prompt` is passed through verbatim, unmodified, by design (see Phase 4's Unicode-preservation guarantee).

## 8. Generation State Machine

Generation status values must not change arbitrarily. Standard states (source contract, target):

```
draft → validating → queued → submitted → processing → post_processing → uploading → completed
```

On failure: `processing → failed`. A generation must never return to `processing` after completing. Status updates must be idempotent.

**Current implementation note:** the current database `status` column supports a narrower, already-working set: `queued`, `processing`, `completed`, `failed`, `cancelled` (see `src/types/database.ts`, `Generation.status`). Finer-grained progress (`validating`, `submitted`, `post_processing`, `uploading`) already exists — but as `metadata.orchestration.stage`, a richer in-JSON value written by `status-manager.ts`, not as new database `status` enum values. **Do not add new `status` column values to chase the source contract's exact list** — the `metadata.orchestration.stage` field already serves that purpose without a schema change, per the override section above.

## 9. Idempotency Rule

A user double-clicking a button must not cause double charging. Every generation request should use an idempotency key (`user_id + project_id + client_request_id`). A repeated request must not deduct new credit, must not create a new provider job, and must return the existing generation record. A webhook delivered twice must not be processed twice.

**Current implementation note:** already implemented for the Trigger.dev dispatch path — `generationTask.trigger()` is called with `idempotencyKey: generationId` (1-hour TTL), and independently, `claimGeneration`'s `.eq("status","queued")` compare-and-set in `status-manager.ts` prevents a second execution of the same row regardless of dispatch path. No credit system exists yet, so the "double charge" half of this rule has nothing to apply to yet.

## 10. Credit and Cost System

Platform credit must be kept separate from provider cost. The following concepts must not be conflated: provider cost, platform credit price, user subscription, promotional credit, refunded credit.

Suggested tables: `credit_wallets`, `credit_ledger`, `subscriptions`, `model_pricing`, `provider_cost_records`.

Credit movements should be recorded as immutable ledger entries, e.g.:

```
+500 subscription_credit
-80  generation_reservation
+80  generation_refund
-60  final_generation_charge
```

Correct method: reserve estimated credit at generation start → send provider request → finalize real cost on success → refund credit on failure per policy → write every movement to the ledger. Merely decrementing a single `credits` number on the user table is not sufficient.

**Current implementation note — target architecture, not implemented.** No credit, wallet, subscription, or ledger tables or logic exist in the current schema or codebase. This entire section is a future phase (Phase 9 in the roadmap below). No generation currently deducts or reserves any credit.

## 11. Provider Cost Protection

Every model should define `estimated_cost`, `maximum_allowed_cost`, `user_credit_cost`, `timeout`, and `retry_policy`. Before starting a job: check user credit, check plan access, estimate provider cost, check daily spend limit, check provider maintenance state. Monthly spend limits must not be exceedable by uncontrolled continued generation.

**Current implementation note — target architecture, not implemented.** No cost-protection fields exist on the current `ModelRegistryEntry`/`ModelCapabilities` types. The fal.ai adapter has its own internal request timeout (90s) but no cost ceiling logic. Future phases (Phase 9) would add this without needing to touch the current provider adapters' core contract.

## 12. Retry and Fallback Rules

Not every error should be retried.

- **Retryable:** 429 rate limit, 502 bad gateway, 503 service unavailable, 504 timeout, transient network errors.
- **Not retryable:** 401 invalid API key, 403 forbidden, 400 invalid parameter, unsupported resolution, unsupported duration, moderation rejection, insufficient provider balance.

Retries should use exponential backoff (e.g. 30s, 2m, 5m, 15m), with a limited number of attempts per provider. Provider fallback should only apply when a compatible model exists — a user who explicitly chose a model must not be silently switched to another.

**Current implementation note:** already implemented and more precisely than the source's example backoff schedule — `OrchestrationErrorCode` in `src/lib/orchestration/errors.ts` classifies every error as retryable or not (matching the retryable/non-retryable split above almost exactly: `PROVIDER_RATE_LIMIT`, `PROVIDER_TIMEOUT`, `PROVIDER_FAILED`, `OUTPUT_MISSING`, `OUTPUT_DOWNLOAD_FAILED`, `STORAGE_UPLOAD_FAILED`, `DATABASE_UPDATE_FAILED` are retryable; `PROVIDER_AUTH_ERROR`, `PROVIDER_QUOTA_EXCEEDED`, `INVALID_INPUT`, capability errors are not). The Trigger.dev task (`src/trigger/generation-task.ts`) uses `trigger.config.ts`'s retry policy (`maxAttempts: 3`, exponential backoff with jitter) and a `catchError`/`AbortTaskRunError` hook that consults this same classification, plus a `resetForRetry` requeue step so a genuine retry can re-claim the row. No provider fallback (switching models automatically) exists — not needed yet with a single real provider (fal.ai).

## 13. AI Director's Job

The AI Director is not the generation model itself. It: understands user intent, determines scene type, structures the prompt, proposes camera direction, chooses lens and lighting, determines motion intensity, describes character/environment references, ranks candidate models, and produces the generation settings needed. Its output should be schema-validated (e.g. with Zod). It must never itself deduct credit, choose an API key, call a free-form endpoint, invent a model outside the registry, or make uncontrolled database changes.

**Current implementation note — target architecture, not implemented.** No AI Director module exists. Model selection today is a direct, explicit choice (the model picker, or the `?model=` dev override), not an AI-ranked recommendation.

## 14. Prompt Compiler Layer

A single generic prompt should not be sent to every video model. Each model family should have its own prompt compiler (illustrative: `prompt-compilers/runway.ts`, `kling.ts`, `veo.ts`, `seedance.ts`, `image-model.ts`), translating a shared creative brief (subject, action, environment, camera, lighting, style, timing, constraints, negative instructions) into that model's specific format. The provider adapter sends the request; the prompt compiler prepares the artistic, model-specific prompt — these are not the same thing.

**Current implementation note — target architecture, not implemented.** Today, `generation.prompt` is passed through to every provider verbatim and unmodified (this is deliberate for the text-to-speech Unicode-preservation guarantee established in Phase 4, and is not itself wrong for TTS). A per-model-family prompt compiler for creative video/image prompts does not exist yet.

## 15. Character Consistency

Character consistency must not rely on writing a name into a prompt. The system should have distinct entities: `characters`, `character_versions`, `character_reference_assets`, `character_embeddings`, `character_usage`. A character record may include name, description, facial features, hair, clothing, apparent age, color palette, reference images, an approved primary image, negative traits, and model-specific settings. Updating a character must not break older projects' references — hence versioning.

**Current implementation note — target architecture, not implemented.** No character entities exist in the current schema.

## 16. Shared Creative Asset System

The system should not just keep a flat file list. Reusable asset types should include: character, location, prop, product, style, color palette, camera preset, voice, music, logo, brand kit. Each asset may belong to a project, may belong to a workspace, may be used across multiple scenes, may be versioned, and may be archived rather than deleted.

**Current implementation note — target architecture, not implemented.** Only per-generation `input_url`/`output_url` file references exist today; no reusable, cross-project asset library.

## 17. Project / Scene / Shot Hierarchy

A film project is not a single generation record. Suggested structure:

```
Workspace
  └── Project
       └── Sequence
            └── Scene
                 └── Shot
                      └── Generation
                           └── Output Asset
```

A shot may have multiple generation attempts; the user should be able to mark one as the selected output.

**Current implementation note — target architecture, not implemented.** The current hierarchy is flat: `Project → Generation`. No workspace, sequence, scene, or shot tables exist.

## 18. Hero-Frame-First Workflow

For cinematic video, rather than starting video generation directly, this flow should be supported: creative brief → storyboard → hero frame generation → hero frame approval → image-to-video → post-processing → final edit. This helps lock character, lighting, composition, and art direction before video generation begins.

**Current implementation note — target architecture, not implemented.**

## 19. Asset Upload Architecture

Large files should not pass through the Next.js server. Correct flow: frontend → backend issues a signed upload URL → file uploads directly to storage (R2 in the source contract) → backend verifies the asset record. Upload-time checks should include MIME type, file size, extension, image resolution, video duration, malicious file scanning, and metadata stripping. A user-supplied external URL must never be sent directly to a provider — it must first be safely ingested or verified into the system.

**Current implementation note:** partially implemented differently — Cinefield's current input upload path uses the Supabase Storage JS client directly from the authenticated browser (`supabase.storage.from("generation-inputs").upload(...)`), which is itself a form of direct-to-storage upload (not proxied through a Next.js request body), matching the *intent* of this rule even though the mechanism (Supabase client upload vs. a custom signed-upload-URL endpoint) differs from the source's R2-oriented description. MIME/size checks exist client-side (`ALLOWED_INPUT_MIME_TYPES`, `MAX_INPUT_FILE_SIZE`) and at the bucket level (`allowed_mime_types`, `file_size_limit` — verified directly against the live Supabase bucket config). Malicious-file scanning and metadata stripping are not implemented.

## 20. Storage Structure

Example R2 folder layout from the source contract:

```
users/{userId}/
  projects/{projectId}/
    source/
    references/
    generations/{generationId}/
      raw/
      processed/
      thumbnails/
      previews/
```

File names must not be derived directly from the user's original uploaded filename — a UUID or safe internal id should be used. Private assets should be served via signed URL; public community content should live in a separate public delivery area.

**Current implementation note (see also override section above):** Cinefield's real, working storage layout today is Supabase Storage, not R2: `<clerkUserId>/<projectId>/<generationId>/<generated-file-name>.<ext>` in the private `generation-outputs` bucket (`buildOrchestrationOutputPath` in `output-storage.ts`), file names already using a timestamp+random suffix rather than the user's original name, and signed URLs already minted only for authenticated responses, never persisted. This satisfies the *principles* of section 20 today using Supabase Storage instead of R2 — migrating the literal bytes to R2 is Phase 12, a separate future decision, not a correction of a current gap.

## 21. FFmpeg and Post-Processing

FFmpeg may be used for format conversion, codec standardization, thumbnail generation, preview generation, video concatenation, adding audio, fades, resize/crop, frame extraction, and metadata stripping. FFmpeg must not run inside a Next.js request — a separate worker or Trigger.dev task should be used. Raw provider output should be preserved; processed output should be saved as a separate asset.

**Current implementation note — target architecture, not implemented.** No FFmpeg or post-processing step exists yet; outputs are stored exactly as the provider (or mock) produced them.

## 22. Webhook Security

Provider webhooks must not be trusted directly. A webhook endpoint should perform: signature verification, timestamp check, replay protection, known-provider check, known-external-job-id check, idempotency, valid status transition check, and payload schema validation. A webhook should only update job status and enqueue any needed follow-up work — heavy media processing must not happen inside the webhook request itself.

**Current implementation note — target architecture, not implemented.** No webhook endpoint exists. The current fal.ai adapter is synchronous (`executionMode: "sync"`) — it awaits the result directly in `submit()` rather than receiving a webhook. A webhook layer would be needed for any future asynchronous provider.

## 23. Polling Rule

For providers that do not support webhooks, polling should be used. Polling should not run unbounded, should use an exponential or controlled interval, should have a maximum job duration, should respect the provider's rate limit, should stop once the job completes, and should not re-query a cancelled job. Example interval progression: 10s, 20s, 30s, 60s, 60s.

**Current implementation note:** implemented, but at a different layer than the source contract describes — Cinefield's current polling is not a provider-status poll (no async provider exists yet to poll), it is the **browser polling its own database row** after a Trigger.dev dispatch (`pollGenerationUntilTerminal` in `CinemaStudioWorkspace.tsx`, fixed interval 1.5s, capped at 40 attempts / ~60s). This is a legitimate, working, different mechanism serving the same underlying need (the client eventually learning that an async job finished) — it is not a gap to be "fixed" to match the source's exact interval schedule.

## 24. Cloudflare's Role

Cloudflare may be used for: AI Gateway, Workers AI, rate limiting, WAF, bot protection, DDoS protection, R2 storage, CDN, signed delivery, queues, or helper edge tasks. Cloudflare AI Gateway is appropriate for short AI tasks: prompt enhancement, image analysis, task classification, moderation, embedding, reranking, text-model fallback, usage logging. **Cloudflare AI Gateway is not a long-running video job orchestrator. Cloudflare Workers AI is not Runway or fal.ai. Cloudflare R2 is not a generation database.** Each product should be used for its own job.

**Current implementation note — not yet integrated (see override section above and Phase 5A–5C).** No Cloudflare product is currently connected. When it is, AI Gateway and Workers AI must be tracked as separate concepts (gateway vs. actual provider), per the override section.

## 25. Trigger.dev's Role

Trigger.dev should carry out: long video generation jobs, retry, polling, provider status checks, result download, post-processing, storage upload, Supabase status updates, credit finalization or refund, thumbnail generation, notification creation. **Trigger.dev is not a model. Trigger.dev is not a provider.** It is purely a reliable task-execution and orchestration layer.

**Current implementation note:** already implemented exactly this way. `src/trigger/generation-task.ts` is one generic task (`cinefield-generation`) that calls the same `executeGeneration()` the direct/HTTP path uses — it does not itself know about providers, models, or workflows. Post-processing, credit finalization, and notifications are not yet implemented (no post-processing pipeline, no credit system, no notifications table).

## 26. Supabase's Role

Per the source contract, Supabase is intended as the primary source for records including: `profiles`, `workspaces`, `workspace_members`, `projects`, `sequences`, `scenes`, `shots`, `generations`, `assets`, `characters`, `locations`, `props`, `styles`, `credit_wallets`, `credit_ledger`, `subscriptions`, `provider_jobs`, `webhook_events`, `model_registry`, `notifications`, `community_posts`, `comments`, `likes`. Supabase is not required to be the sole large-video-file storage solution — large media may live in R2, with Supabase holding the metadata/ownership record.

**Current implementation note — the vast majority of this table list is target architecture, not implemented.** The current schema (verified against `supabase/migrations/20260805132704_remote_schema.sql`) has exactly three tables: `profiles`, `projects`, `generations`. Every other table named above (`workspaces`, `workspace_members`, `sequences`, `scenes`, `shots`, `assets`, `characters`, `locations`, `props`, `styles`, `credit_wallets`, `credit_ledger`, `subscriptions`, `provider_jobs`, `webhook_events`, `model_registry`-as-a-table, `notifications`, `community_posts`, `comments`, `likes`) does **not** exist today and must not be assumed present by any future change. `model_registry` in particular is currently code (`model-registry.ts`), not a database table — Phase 7 ("Model Registry Unification") is where that distinction would be revisited, not before.

## 27. Clerk / Supabase User Mapping

Clerk is the source of user identity. Supabase is the source of application profile and business data. Example mapping: `Clerk user ID → profiles.clerk_user_id`. A `userId` sent from the frontend must never be trusted — the backend must take the user id from a verified Clerk session. Supabase Row Level Security must be applied. The service role key must never be sent to the frontend.

**Current implementation note:** already implemented exactly this way. Every server route/orchestrator call takes `clerkUserId` from a verified server-side `auth()` call, never from the request body (see `orchestrator.ts`'s own comment: "must come from a verified server-side Clerk session — never from the request body"). `SUPABASE_SERVICE_ROLE_KEY` is read only in `src/lib/supabase/supabaseAdmin.ts`, marked `server-only`, and never exposed via `NEXT_PUBLIC_`.

## 28. Stripe and Subscriptions

Stripe should not be treated as merely a payment-collection tool. The intended flow: checkout → Stripe webhook → webhook verification → update subscription record → add credit package to the ledger. Credit must never be granted just because the frontend claims payment succeeded — only after a verified Stripe webhook. Events to handle: checkout completed, subscription created/updated/cancelled, invoice paid, invoice payment failed, refund, chargeback.

**Current implementation note — target architecture, not implemented.** No Stripe integration, webhook endpoint, or subscription table exists in the current codebase or schema. This is Phase 10 in the roadmap below (explicitly *after* Cloudflare and multilingual-prompt phases, per the user-specified updated order).

## 29. Community System

Community content should have its own publication layer, separate from the generation table. Publishing an item should record: public title, description, thumbnail, a display-safe model name, permission to share settings used, remix permission, visibility, and moderation status. Private prompts and hidden provider data must not become public automatically. Remixing a public project should create a new, independent project — the original must not be modified.

**Current implementation note — target architecture, not implemented.** No community/publication tables or UI exist.

## 30. Collaboration and Workspace

Future team functionality may support roles: owner, admin, editor, viewer, billing. Each project should belong to a workspace rather than a single user, enabling future team members, shared projects, comments, an approval system, a shared credit pool, and a brand kit. Even in a single-user first version, the data model should be workspace-ready.

**Current implementation note — target architecture, not implemented.** Projects currently belong directly to a `clerk_user_id`; there is no workspace table or concept.

## 31. MCP Architecture

MCP lets AI agents securely call tools in the project. The MCP server must not hand provider API keys directly to agents — MCP tools must call the backend service layer. Example tools: `list_models`, `create_project`, `list_projects`, `upload_reference`, `generate_image`, `generate_video`, `get_generation_status`, `list_generations`, `get_generation_result`, `cancel_generation`, `list_characters`, `create_character`. MCP calls must go through the same rules as the normal web app: user authentication, authorization, credit, model registry, moderation, rate limit, provider adapter, audit log. The web app and MCP must not be two separate generation systems — both must use the same core service.

**Current implementation note — target architecture, not implemented.** No MCP server exists in this repository yet.

## 32. Asynchronous Result for MCP

A video generation MCP request must not be held open for minutes. The correct response is immediate acknowledgment (`{"generationId": "gen_123", "status": "queued", "message": "Generation started."}`), with the agent later calling a `get_generation_status` tool. Once complete, the result should be returned via a secure URL.

**Current implementation note — target architecture for MCP specifically, but the underlying mechanism already exists and is proven.** `/api/orchestration/execute` in trigger mode already returns immediately with `{status: "queued", ...}` rather than blocking (Phase 3), and a signed URL is only produced once the generation is actually complete (Phase 3–4). A future MCP layer would reuse this exact mechanism, not build a new one.

## 33. Security and Moderation

Controls that should exist: prompt moderation, upload moderation, rate limiting, IP abuse detection, per-user limits, suspicious-account detection, malicious URL blocking, SSRF protection, file validation, API key protection, webhook verification, audit log, admin ban system. Personal/sensitive data policy must be considered when logging user prompts.

**Current implementation note:** partially implemented. API key protection (server-only env vars, never logged — verified explicitly in `fal-provider.ts`'s own comments and code), and basic file validation (MIME/size checks) exist. Prompt/upload moderation, rate limiting, IP abuse detection, SSRF protection beyond the output-normalizer's HTTPS-only fetch restriction, audit logging, and an admin ban system do not exist yet.

## 34. Observability

Every generation should have a traceable correlation id: `request_id`, `generation_id`, `provider_job_id`, `trigger_run_id`, `user_id`, `project_id`. Logs may record which endpoint was called, which model was selected, which provider was used, how many retries occurred, how long the provider took, what error occurred, when credit was reserved, whether credit was refunded, whether the file was uploaded to storage. Logs must **never** contain: API keys, authorization headers, Stripe secrets, the Supabase service role key, or full sensitive user data.

**Current implementation note:** partially implemented. `orchestrator.ts`'s `log()` function already logs `generationId`, `provider`, `modelId`, `workflow`, `stage`, `durationMs`, `result`, and `errorCode` — explicitly documented as "never includes prompts, tokens, or payloads." `trigger_run_id` is available (returned in the dispatch response) but not currently cross-logged with the generation id server-side. `request_id` and structured credit-lifecycle logging do not exist (no credit system yet). No Sentry integration exists yet.

## 35. Admin Panel

Should include at least: users, subscriptions, credit movements, generation records, provider jobs, failed jobs, model status, provider status, model prices, usage cost, moderation records, community content, webhook events, system announcements. Should support: disabling a model, putting a model in maintenance mode, changing price, adding credit to a user, retrying a generation, hiding content, suspending a user. Every admin action must be written to an audit log.

**Current implementation note — target architecture, not implemented.** No admin panel exists in this repository.

## 36. Feature Flag System

New models should not be opened directly to all users. Feature flag support should exist (e.g. `runway_gen_new_enabled`, `cinema_studio_beta`, `mcp_enabled`, `community_publish_enabled`, `auto_model_routing_enabled`), operable at global, plan, workspace, user, or percentage-rollout level.

**Current implementation note — target architecture, not implemented as a general system.** One narrow, real precedent already exists: `GENERATION_EXECUTION_MODE` + `TRIGGER_SECRET_KEY` presence together gate whether "trigger" execution mode activates (`resolveExecutionMode()` in `execution-mode.ts`) — an env-var-level flag, not a general per-user/per-plan feature flag system. Per the override section above, any future integration (Cloudflare, Runway, etc.) should follow this same "additive, gated, defaults to the safe/existing path" pattern until a real feature-flag system (if ever needed) is built.

## 37. Model Health System

Health status should be tracked per provider/model: `operational`, `degraded`, `rate_limited`, `maintenance`, `disabled`. If a provider's error rate rises, the system may stop accepting new jobs, show a warning on the model card, exclude the model from automatic selection, or notify an admin. This decision must not be left to the AI model alone.

**Current implementation note — target architecture, not implemented.** `ModelRegistryEntry.enabled: boolean` exists today (a static on/off switch checked by the orchestrator — `MODEL_DISABLED` error), but there is no dynamic health tracking, error-rate monitoring, or automatic exclusion.

## 38. Model Routing Rules

Automatic model selection should be constrained by deterministic rules, evaluating: task type, input type, requested quality, duration, resolution, aspect ratio, need for character consistency, camera control, audio need, user's plan, user's credit, provider status, estimated cost, estimated generation time. The AI Director may propose; the backend registry and policy engine make the final decision.

**Current implementation note — target architecture, not implemented.** Model selection today is a direct, explicit user choice (or the `?model=` dev override) — there is no automatic routing/ranking layer.

## 39. Database Migration Rule

The production database must not be changed manually or uncontrollably — every change must go through a migration. Before migrating: review existing data, check backward compatibility, prepare a rollback plan, evaluate index needs. Table/field names should not be overly coupled to a specific provider (e.g. avoid `fal_video_jobs`; prefer `provider_jobs`). Provider-specific raw payloads, if needed, may live in a JSONB column or a separate provider-metadata table.

**Current implementation note:** the current schema is small (3 tables) and already avoids provider-coupled naming (`generations.provider` is a plain string column, not a provider-specific table). Provider-specific detail is already kept out of the schema and confined to code (`ModelRegistryEntry`) and to `metadata` (a generic JSONB column), consistent with this rule. Per the override section, no schema change should be made merely to anticipate a future example from this contract.

## 40. Development Environments

At least three environments should be used: development, preview/staging, production — each with its own Supabase project (or safely separated schema), Clerk configuration, Stripe mode, Cloudflare gateway, R2 bucket, Trigger.dev environment, and provider API keys. Development keys must not be used in production. Stripe test and live keys must not be mixed.

**Current implementation note:** development environment exists and is what has been verified throughout Phases 1–4 (local `.env.local`, a single Supabase project, Clerk in development-key mode — the app itself already warns about this in the browser console, Trigger.dev's own "dev" environment via `trigger dev`). Distinct staging/production environments do not exist yet — see Phase 11 ("Vercel Staging") in the roadmap.

## 41. Test Strategy

At minimum: unit tests (model registry, credit calculation, prompt compiler, input validation, status transitions, error normalization), integration tests (Supabase records, Clerk verification, Stripe webhook, provider adapter, R2 upload, Trigger.dev task), contract tests (provider request/response shape hasn't silently changed), and end-to-end tests (sign in → create project → upload asset → start generation → credit reserved → job completes → video visible). Real paid provider calls should not run in every test. A mock provider adapter must exist.

**Current implementation note:** no automated test suite (unit/integration/contract/e2e) exists in this repository yet — verification so far has been manual, live testing per phase (documented in each phase's report), plus `npx tsc --noEmit` and `npm run build` as the current pre-commit gate. **The mock provider adapter this section calls for already exists and is exactly how every phase has been verified at zero cost** (`mock-image`, `mock-video`, `mock-tts` in `src/lib/orchestration/providers/mock-provider.ts`).

## 42. Mock Provider

A mock provider should exist so flow can be tested during development without spending money:

```
providers/mock/
```

A mock provider should: generate a fake job id, return "processing" for a while, return test video/output, produce controlled errors, simulate timeouts, simulate rate limits — so credit, retry, webhook, and UI states can all be tested without real provider cost.

**Current implementation note:** already implemented, at `src/lib/orchestration/providers/mock-provider.ts` (not the source's illustrative `providers/mock/` path — see the folder-layout note in section 6/the override section). It already supports controlled failure modes via `mock_mode` metadata (`success`, `provider-failure`, `retryable-failure`, `missing-output`), and produces genuine, spec-valid output bytes rather than fake placeholders: a real PNG (`png-encoder.ts`) for image models and a real WAV tone (`wav-encoder.ts`) for `mock-tts`, deterministically seeded per generation. This has been the verification method for every phase so far.

## 43. Deployment Rule

The Next.js app may run on a platform like Vercel. Heavy tasks — long polling, FFmpeg, large file download/upload, long generation waits — must not be tied to a frontend deployment's request lifecycle; these belong in Trigger.dev workers or a suitable compute environment. Before every deployment: TypeScript check, lint, unit tests, migration check, environment variable check, build, smoke test.

**Current implementation note:** the Trigger.dev half of this is already real — long-running generation work is dispatched to Trigger.dev precisely so it is not tied to a Next.js request lifecycle (Phase 3). No Vercel deployment exists yet (local dev only) — see Phase 11. The current pre-commit gate (established across Phases 2–4) is `npx tsc --noEmit` + `npm run build`; there is no lint step, automated test step, migration check, or smoke test step yet in that gate.

## 44. Changes That Would Break the Project

The following must not be done: treating fal.ai and Runway as the same provider; using a provider's name as a model name; mistaking Cloudflare for a video generator; mistaking Trigger.dev for a model router; calling a provider directly from the frontend; putting an API key in a `NEXT_PUBLIC_` variable; holding a Next.js endpoint open until generation completes; stuffing every provider's conditional logic into one `generateVideo` file; keeping the frontend's model list independent of the backend; deducting credit only in the frontend; applying uncontrolled fallback on provider error; processing the same webhook twice; storing a large video as base64 in the database; sending the Supabase service role key to the browser; blindly trusting a user-supplied storage URL; handing every AI task to a single LLM; directly calling a model id the AI Director invented; changing the production database without a migration; running unlimited generation without tracking provider cost; using production Stripe or provider keys in a test environment.

**Current implementation note:** every item in this list that is currently applicable is already respected: providers are kept distinct in the model registry (`providerId` field), no API key is ever in a `NEXT_PUBLIC_` variable (verified across all provider adapters), `/api/orchestration/execute` in trigger mode never holds the request open (returns `202` immediately), there is one generic `executeGeneration()` rather than per-provider branching logic, the frontend model list is not independent of the backend registry for orchestration models (`isOrchestrationModel` checks are backend-registry-derived), no credit deduction exists anywhere (frontend or backend) so there's nothing to get wrong there yet, webhook double-processing has no webhook to double-process yet, no base64 video/audio is ever stored (real bytes go to Storage, only the path to the database), the service role key is `server-only` and never shipped to the browser, and schema changes so far (none, in fact, across Phases 2–4) have gone through reviewed, documented phases rather than ad hoc edits.

## 45. Original Build Order (Source Contract)

The source contract's own suggested order was:

- **Faz 1 — Base platform:** Next.js, Clerk, Supabase, basic user profile, workspace, project, asset upload, R2.
- **Faz 2 — Generation core:** generation table, model registry, provider interface, mock provider, Trigger.dev, status machine, credit reservation.
- **Faz 3 — First real provider:** fal.ai adapter, one image model, one video model, polling or webhook, result normalization. ("First, one provider should work perfectly.")
- **Faz 4 — Second independent provider:** Runway adapter, separate API client, separate schema, separate error mapping, separate provider job handling. ("Runway must not be added inside fal.ai's code.")
- **Faz 5 — Cloudflare AI layer:** AI Gateway, prompt enhancement, vision analysis, moderation, rate limit, AI logging.
- **Faz 6 — Cinema system:** AI Director, prompt compiler, camera presets, style presets, characters, locations, props, hero frame, scene/shot structure.
- **Faz 7 — Payments:** Stripe, subscription, credit ledger, model pricing, refund policy, usage dashboard.
- **Faz 8 — Community:** publish, profile, project page, remix, like, comment, moderation.
- **Faz 9 — MCP:** MCP authentication, tool definitions, generation service connection, async status, audit log, rate limit.
- **Faz 10 — Scaling:** provider health, feature flags, cost analytics, admin panel, queue concurrency, CDN optimization, observability, backup, disaster recovery.

Each phase should be tested before moving to the next.

**See `IMPLEMENTATION_ROADMAP.md` for the current, updated phase order** (Phase 5A onward), which reorders the source's Faz 5+ sequence based on what has actually been built (Faz 1–3 are effectively done, in a different but compatible shape; Faz 4/Runway has been deliberately pushed later; a dedicated audio/TTS track has been added that the source contract did not originally have a phase number for).

## 46. Working Method for Coding Agents

Before making a change in this project: inspect the current repository structure; read the relevant files; check the current database schema; check whether the same feature already has another implementation; state which architectural layer will be touched; verify the provider/model/feature distinction; make small, reversible changes; run TypeScript and tests; verify existing working providers are not broken; report the change file-by-file. **Code, folders, tables, environment variables, or endpoints must not be assumed to exist without having seen them. Fictional code connections must not be invented when information is missing.**

**Current implementation note:** this section is not superseded by anything — it is a direct, standing instruction to every future agent working in this repository, this phase included. Every "current implementation note" throughout this document was written by directly reading the relevant source files, migration SQL, and live Supabase bucket configuration, not by assumption.

## 47. Final Architectural Principle

The system's "brain" is not a single AI model. AI Director produces creative decisions. The policy engine validates the decision. The model registry determines allowed models. The provider router selects the correct adapter. The provider adapter makes the real API call. Trigger.dev executes the long task. Cloudflare governs AI calls. Supabase records the system. R2 stores media. FFmpeg processes the result. Clerk verifies the user. Stripe manages payment.

Each layer must do only its own job. The project's sustainability depends on providers never being conflated with each other, and on the shared generation core being preserved. Adding a new provider should not require rewriting the existing system. Adding a new model should, in most cases, be completable with: a registry entry + the relevant adapter support + a prompt-compiler setting + pricing + a test.

**When a proposed change conflicts with this architecture contract, the risk must be stated explicitly before the change is applied.**

**Current implementation note:** the "adding a model = registry entry + adapter support" principle is already proven true in this codebase — `fal-flux-schnell` (Phase 2) and `mock-tts` (Phase 4) were each added as a registry entry plus (for fal) reuse of the existing generic fal adapter, with zero changes to the orchestrator, Trigger.dev task, or API route. This is direct, working evidence that the contract's final principle already holds for this codebase.
