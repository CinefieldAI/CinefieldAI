# Game-day / chaos exercise runbook

Phase 26. Roadmap: "DR ve self-healing dokümanlarının yalnız teoride değil
gerçek hata koşullarında çalıştığını düzenli kanıtlamak" — prove regularly
that the DR and self-healing documents work under real failure conditions,
not only on paper.

**A drill you did not measure did not happen.** The whole point is the
number: how long did recovery actually take, and how does that compare to a
target someone with authority approved. Running a scenario and concluding
"it seemed fine" is the failure mode this runbook exists to prevent.

---

## Before you start: what is real today, and what is not

| Thing | Status |
| --- | --- |
| Scenario catalogue | **REAL** — `src/lib/chaos/game-day-catalogue.ts`, 10 scenarios |
| Recovery measurement | **REAL** — Phase 15-D/2's `measureRecovery()`, unmodified |
| Outcome classification | **REAL** — `classifyGameDayOutcome()`, cannot fabricate a PASS |
| Evidence store | **REAL** — `game_day_exercises`, append-only |
| Admin view | **REAL** — `/admin/game-day`, read-only |
| RTO/RPO targets | **EMPTY** — no business-approved number exists. Every drill records `NO_TARGET_CONFIGURED` until someone sets one. |
| AWS FIS templates | **CODE_COMPLETE, NEVER APPLIED** — `infra/modules/fis-experiments/`, not wired into any environment |
| Staging environment | **DOES NOT EXIST** |
| Production drill | **REFUSED** — `chaos-environment-guard.ts` denies `production` unconditionally, and the database CHECK does too |

So today a drill is a **local or test-environment exercise**: you break
something in a controlled way against a local/test target, watch what the
already-existing mechanisms do, and record the measured result.

---

## PLAN → INJECT → OBSERVE → RECOVER → MEASURE → RECORD

### 1. PLAN
- Pick a scenario id from the catalogue. Do not invent one — an unknown id
  is refused by `recordGameDayExercise()`, on purpose.
- Read that scenario's `expectedSafeBehavior`. It names the mechanism that
  should already handle this (Phase 7 routing, Phase 15-D DLQ redrive,
  Phase 14 rollback). **You are testing that mechanism, not this layer.**
- Note the `blastRadius`. Anything above `single_runtime` deserves a second
  person watching.

### 2. INJECT
Locally: stop the dependency, point it at a dead address, or fill the queue.
No tooling in this repository injects a fault for you — that is 26-B's AWS
FIS work, which is written and unapplied.

Record the wall-clock instant you injected it. That is `startedAt`.

### 3. OBSERVE
- Does readiness report what the health matrix says it should
  (`src/lib/health/health-contract.ts`)? A `CRITICAL` dependency going down
  must produce `UNREADY`, a `DEGRADED_ALLOWED` one must produce `DEGRADED`.
- Did an alert fire through Phase 13-D's router — and only the ones that
  should have?
- Did anything happen that should NOT have: a duplicate generation, a double
  charge, a second orchestration path, a silent success? Each of these is a
  **failed guardrail**, recorded as its own reason code.

### 4. RECOVER
Restore the dependency. Record the instant the affected component reported
service restored — that is `serviceRestoredAt`. If the scenario is a
database or media recovery, restore validation must PASS (Phase 15-C) before
it counts; `measureRecovery()` enforces this and will report
`RECOVERY_INCOMPLETE` otherwise.

### 5. MEASURE
Do not compute anything by hand. Submit the raw timestamps —
`POST /api/admin/game-day/record` recomputes the outcome server-side. You
cannot submit a verdict; there is no field for one.

### 6. RECORD
The response is the durable record. Then, per the roadmap's own 26-D
criterion, write down:
- which guardrail failed, if any (`failedGuardrails`, reason codes only)
- what permanent action follows (`permanentActions`, reason codes only)
- which runbook you updated (`runbookUpdateRef`)

A drill that found nothing and changed nothing is worth recording too — the
absence of findings is itself evidence, as long as it was measured.

---

## What must never happen

- **No production drill.** Not with a flag, not with an approval, not with
  a "just this once". Changing that is an edit to
  `src/lib/chaos/chaos-environment-guard.ts`, reviewed like any other
  security boundary.
- **No AI-initiated fault injection.** The roadmap is explicit: "Fault
  injection başlatma yetkisi AI'a varsayılan verilmez." No AI-callable path
  to any of this exists (test G26-31).
- **No fabricated pass.** If the measurement engine could not conclude, the
  exercise is `INCONCLUSIVE`. That is a real, useful result. Writing `PASS`
  over it is not.
- **No prose in the evidence fields.** `failedGuardrails`/`permanentActions`
  take reason codes (`^[a-z][a-z0-9_]{1,64}$`), refused otherwise. Prose
  belongs in the postmortem document this record points at.

---

## Setting an RTO/RPO target

`RTO_TARGETS`/`RPO_TARGETS` in `src/lib/recovery/recovery-target-registry.ts`
are empty because a recovery-time commitment is an SLA promise, and nobody
has made one. Populating either is a **business decision**, then a one-file
edit — nothing else needs to change to consume it. Until then every drill
honestly reports `NO_TARGET_CONFIGURED`, which is not the same as passing.
