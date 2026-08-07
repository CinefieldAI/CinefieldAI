# Cinefield — AI Gateway Policies

Status of every gateway-level policy: what is **implemented**, what is
**deliberately not implemented**, and where each one lives. Written at the
end of Phase 5I.

> This document records **current, verified state only**. Anything not
> implemented is listed as such, with the reason — nothing here describes
> behavior the code does not actually have.

---

## 1. Enablement gate (implemented)

Cloudflare is **double-gated**. Credential presence alone never activates
anything:

- `CLOUDFLARE_AI_ENABLED` must be exactly `"true"` (after whitespace
  normalization), **and**
- all three of `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_GATEWAY_ID`,
  `CLOUDFLARE_API_TOKEN` must be present and non-empty.

Enforced by `isCloudflareEnabled()` in `src/lib/cloudflare/gateway-config.ts`,
and re-checked independently in:

- `ai-gateway-client.ts` → `performCloudflareRequest()` (first statement,
  before any config is even read)
- `cloudflare-workers-ai-provider.ts` → `submit()`
- every Phase 5H/5I module (`prompt-intelligence`, `vision-analysis`,
  `content-moderation`, `text-embeddings`, `text-reranking`)

Default in `.env.local` is `false`. It is switched on only for a controlled
test and switched back immediately afterward.

## 2. Logging policy (implemented)

- `cf-aig-collect-log-payload: "false"` is sent on **every** gateway request
  (`ai-gateway-client.ts`, in the one centralized request helper), so
  Cloudflare's gateway log never retains request/response payloads.
- `CloudflareAiGatewayError` deliberately carries **only** an HTTP status and,
  when available, Cloudflare's numeric error code. Never the response body,
  never headers, never the prompt, never the token.
- No module in this codebase logs a prompt, a credential, a signed URL, or a
  raw provider response.
- `status-manager.ts` persists only a sanitized error **code** into
  `metadata.orchestration.errorCode` — never a provider payload.

## 3. Timeout policy (partially implemented)

| Layer | Timeout | Where |
|---|---|---|
| fal.ai adapter | 90 s, Cinefield-owned `AbortController` | `fal-provider.ts` (`FAL_REQUEST_TIMEOUT_MS`) |
| Trigger.dev task | 300 s max duration | `trigger.config.ts` (`maxDuration`), `generation-task.ts` |
| Browser polling | ~60 s (40 × 1.5 s) | `useGeneration.ts` |
| Cloudflare gateway | **none of its own** | — |

`ai-gateway-client.ts` accepts an optional `AbortSignal` from its caller and
honors it, but defines **no default timeout of its own**. The Cloudflare
adapter passes the orchestrator's context signal through. Not adding an
arbitrary default here is deliberate — a guessed number is not a policy.

## 4. Retry policy (implemented — at the orchestration layer, not the gateway)

Retries are handled **once**, in the generic orchestration layer. The gateway
client itself performs **zero** retries by design, so a request can never be
silently multiplied by two independent retry loops.

- Classification: `isRetryable()` + `DEFAULT_RETRY_POLICY` in
  `src/lib/orchestration/errors.ts`. Retryable codes: `PROVIDER_RATE_LIMIT`,
  `PROVIDER_TIMEOUT`, `PROVIDER_FAILED`, `OUTPUT_MISSING`,
  `OUTPUT_DOWNLOAD_FAILED`, `STORAGE_UPLOAD_FAILED`, `DATABASE_UPDATE_FAILED`.
- Execution: `trigger.config.ts` — 3 attempts, exponential backoff
  (5 s → 60 s, factor 2, randomized jitter).
- State transitions: `generation-task.ts` + `resetForRetry()` in
  `status-manager.ts`. A retry only proceeds when a row was **verifiably**
  requeued (atomic `status="failed"` + `metadata.orchestration.retryable=true`
  compare-and-set); otherwise it aborts with `AbortTaskRunError` rather than
  burning an attempt that would fail on the claim.
- Non-retryable errors (auth, quota, validation, capability) abort
  immediately — they are never retried.

Verified live in Phase 5C with three zero-cost mock scenarios, and again
during Phase 5G's real Cloudflare test (all three attempts ran, then a
correct terminal abort).

## 5. Rate-limit handling (partially implemented)

A provider `429` maps to `PROVIDER_RATE_LIMIT`, which is classified retryable
and therefore picked up by the backoff above
(`fal-provider.ts` / `cloudflare-workers-ai-provider.ts` → `errors.ts`).

**Not implemented:** any Cinefield-side outbound rate limiter, quota
accounting, or per-user throttle. There is no request budget anywhere in this
codebase. Cloudflare AI Gateway supports gateway-level rate limiting through
its own dashboard configuration, which is account state, not repository
state — this document does not claim anything about how that dashboard is
configured.

## 6. Caching policy (implemented as: explicitly disabled)

- `cache: "no-store"` on every gateway fetch (`ai-gateway-client.ts`).
- No `cf-aig-cache-ttl` / `cf-aig-skip-cache` header is sent, so Cloudflare's
  own gateway caching is left at whatever the gateway is configured with —
  Cinefield neither enables nor configures it from code.
- No application-level response cache exists. The two in-memory `Map`s
  (`fal-provider.ts`, `cloudflare-workers-ai-provider.ts`) are **not** caches:
  they hand a single result from `submit()` to `getResult()` within one
  request, are keyed by generation id, and are deleted immediately on read
  (Cloudflare) or on release (fal). The Cloudflare one additionally prunes
  entries older than 5 minutes as crash protection only.

## 7. Fallback policy (deliberately not implemented)

There is **no** automatic provider fallback, model substitution, or silent
downgrade anywhere. This is a deliberate architectural rule, not a gap:

- `getProviderAdapter()` (`provider-registry.ts`) raises
  `PROVIDER_NOT_CONFIGURED` for an unregistered provider rather than quietly
  resolving to the mock provider (or vice versa).
- A disabled or unknown model raises `MODEL_DISABLED` / `UNKNOWN_MODEL`.
- When Cloudflare TTS failed during Phase 5G, the request failed honestly —
  it was not rerouted to another model.

A user must always be able to tell which model actually ran. Adding fallback
would break that guarantee and is out of scope for Phase 5.

## 8. Gateway is not a provider (architectural invariant)

`cloudflare-ai-gateway` is **never** registered in `provider-registry.ts` and
never appears as a `providerId` in `model-registry.ts`. The provider of
record is `cloudflare-workers-ai`; the gateway is recorded only as
`metadata.gateway` on produced outputs. `src/lib/cloudflare/` sits
deliberately outside `src/lib/orchestration/providers/` for this reason.

---

## Summary

| Policy | State |
|---|---|
| Enablement double-gate | ✅ implemented |
| Log-payload suppression | ✅ implemented |
| Error sanitization | ✅ implemented |
| Retry + backoff | ✅ implemented (orchestration layer) |
| Retry state-transition safety | ✅ implemented + verified |
| Rate-limit classification | ✅ implemented |
| Outbound rate limiting / quotas | ❌ not implemented |
| Per-adapter timeout (fal) | ✅ implemented |
| Gateway default timeout | ❌ not implemented (caller-supplied signal only) |
| Response caching | ❌ intentionally disabled |
| Provider fallback | ❌ intentionally absent |
