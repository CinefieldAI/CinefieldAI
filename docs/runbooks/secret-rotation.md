# Secret rotation runbook

Phase 12-D. Roadmap ¶1645 ("KMS/Secrets rotation … runbook'u kur"), ¶1680,
and ¶2680 (managed rotation is Phase 25's to schedule).

**No credential is ever rotated by following this document automatically.**
Every procedure below is performed by a person, and secret/key operations are
on the two-person list (¶2284) — registered in the 12-E policy gate as
`secret.rotate`, currently denying because Phase 16 has no approval workflow.

---

## The six steps

Every rotation, regardless of credential:

1. **Create** the new credential at the issuer. Never edit the old one.
2. **Deploy** the new value to every runtime that holds it — see the injection
   matrix in [least-privilege.md](../security/least-privilege.md). If the
   issuer supports overlap, both are valid here.
3. **Validate** the new credential actually works, from a runtime that uses
   it, before anything is revoked.
4. **Revoke** the old credential at the issuer.
5. **Verify** the old credential is dead. Not "assume revoked" — make a call
   with it and confirm it fails. ¶2684: "Eski credential dead-check ile
   geçersiz doğrulanıyor."
6. **Record** the rotation: what, when, who, why. During an incident this is
   also the timeline.

Step 5 is the one that gets skipped, and it is the one that matters. A revoke
that silently did not apply leaves a live credential that everyone believes is
dead.

---

## Zero-downtime, where the issuer actually supports it

Two credentials valid at once means create → deploy → validate → revoke with
no window. Where that is not possible, there is a window, and pretending
otherwise produces an outage at the worst moment.

**This table is a claim about issuers, and several entries are conservative on
purpose.** Where support was not confirmed against the current dashboard the
entry is `CUT_OVER`, because planning for an overlap that turns out not to
exist fails during an incident. Confirming one and moving it up is a
five-minute change to `secret-registry.ts`.

| Credential | Overlap | Procedure |
| --- | --- | --- |
| `TEMPORAL_API_KEY` | ✅ dual | Temporal Cloud issues multiple concurrent API keys. Full zero-downtime. |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` / `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | ✅ dual | R2 supports multiple API tokens. Rotate the pair together — they are one credential in two variables, and half a pair is an outage. Both names are spelled out rather than abbreviated so this table can be grepped for a variable during an incident. |
| `CLOUDFLARE_API_TOKEN` | ✅ dual | Multiple scoped tokens. Create the new one with the *same* scope, not a wider one. |
| `AZURE_OPENAI_API_KEY` | ✅ dual | Azure issues key1/key2 precisely for this. |
| `OPENAI_API_KEY` | ✅ dual | Multiple concurrent keys. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SIGNING_SECRET` | ✅ dual | Stripe rolls keys with an expiry window. Deferred — Phase 10. |
| `CLERK_WEBHOOK_SIGNING_SECRET` | ✅ dual | Verify against both during the window. Deferred — Phase 12-B. |
| `CLERK_SECRET_KEY` | ⚠️ cut-over | Treat as a brief window. Rotate during low traffic; the blast radius is the whole identity plane, so do not batch it with anything else. |
| `SUPABASE_SERVICE_ROLE_KEY` | ⚠️ cut-over | **Highest-value secret in the system** — it bypasses RLS entirely. Every server runtime except the media worker holds it, so step 2 touches Vercel and four ECS services. Verify each before step 4. |
| `REDIS_URL` (Redis A) | ⚠️ cut-over | The password is inline in the URL. Rotate Redis A and Redis B independently; they are separate credentials (6R.25 / ¶1225). |
| `BULLMQ_REDIS_URL` (Redis B) | ⚠️ cut-over | Same, and confirm afterwards that it still does not equal `REDIS_URL` — `validateConfiguration()` fails closed on that. |
| `FAL_KEY`, `GEMINI_API_KEY`, and every other provider key | ⚠️ cut-over | One provider at a time. Never rotate two providers in one change: if generation breaks you need to know which. |
| `TEMPORAL_CLIENT_CERT` / `TEMPORAL_CLIENT_KEY` | ✅ dual | The self-hosted mTLS alternative to the API key. Temporal accepts multiple client CA certificates, so a new pair can be trusted before the old one is withdrawn. Rotate the two variables together — they are one credential, and a cert without its key is an outage. |
| `TRIGGER_SECRET_KEY` | ⚠️ cut-over | Operational tasks only; not a generation owner since 6R-B. |
| `CINEFIELD_INFRA_DRIFT_INGEST_TOKEN` | ⚠️ cut-over | Phase 18-D. One shared bearer secret with exactly one caller (`infra-drift.yml`). No dual-key mechanism to lean on — generate a new value, update the GitHub Actions secret and the server env var together, confirm the next scheduled drift-check run authenticates, then there is nothing old to revoke since it was never a pair. |
| AWS access keys | — | **Should not exist.** Production uses task roles, which rotate themselves. A long-lived AWS access key in a deployment is a finding, not a credential to schedule. |

---

## Per-runtime deploy targets (step 2)

| Runtime | Where the value lives | Reload |
| --- | --- | --- |
| Web | Vercel project environment variable, production scope | redeploy |
| Temporal worker | ECS task definition secret reference | new task definition revision → rolling restart |
| Provider worker | same | same |
| Realtime dispatcher | same | same |
| DR backup | task role — nothing to rotate | — |

A worker picks up a new secret on restart, not in place. ¶2680 makes "worker
reload doğrulaması" part of Phase 25's automated rotation; until then step 3
means checking the restarted task, not the config.

---

## After any rotation

- `validateConfiguration()` reports `ok` for the environment.
- The old credential fails a real call (step 5).
- A `security_events` row exists if the rotation was incident-driven.

---

## What Phase 25 adds

Managed rotation schedules, automated worker reload verification, and
CloudTrail alerting on anomalous secret reads wired into `security.events`
(¶2680, ¶2683, ¶2694, ¶2696). This document is the manual procedure those
automate — and remains the fallback when the automation is what broke.
