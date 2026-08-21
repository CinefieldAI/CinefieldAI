# Phase 31-A — Go / No-Go Decision Record

**Decision:** `NO_GO_DEFER`
**Date:** 2026-08-21
**Scope:** Phase 31-A only. Phase 31-B…31-E are not triggered by this record.

Phase 31-A's done criterion in the master roadmap is literally *"Go/No-Go
kaydı var"* — a Go/No-Go record exists. This file is that record. Phase 31-A
is therefore satisfied by deciding, not by building.

---

## What `NO_GO_DEFER` means here

An optional capability is deliberately deferred because the product and
economic triggers that would justify it are absent today.

It is **not** `FAIL`, **not** `CANCELLED`, **not** `ABANDONED`, and **not**
`BLOCKED_BY_DEFECT`. Nothing is broken. No required work is unfinished. The
roadmap itself classifies this layer as optional:

> Bu katman aggregator MVP için GEREKLİ DEĞİLDİR. Sadece Cinefield kendi
> LoRA/karakter modellerini eğitmeye karar verirse (Phase 17 Soul/Character
> workflows) devreye girer.

The phase title carries `(Opsiyonel)` in the roadmap heading.

---

## Rationale

Verified against the repository at the time of this record, not from memory:

| Prerequisite | Reality | Evidence |
| --- | --- | --- |
| Soul/Character product consumer | **MISSING** | No `soul`/`character` directory, no production `soulId`/`characterIdentity` code, 0 matching migrations |
| LoRA / training runtime | **MISSING** | 0 files match `lora`, `trainer`, `fine-tune`, `finetune`, `training job`, `model artifact registry`. The only `checkpoint` hits are Temporal workflow polling checkpoints, unrelated to training |
| Live payment / revenue flow | **NO** | No payment-provider dependency, no checkout route, no producer of the `purchase` ledger entry |
| Phase 22 eval foundation | **READY** | `eval-runner.ts`, `golden-dataset.ts`, `eval-store.ts`, `scorers/` |
| GPU / training budget | **NOT DEFINED** | No GPU or training cost ceiling under Phase 15 Cost Guard |

The decisive points:

- **The trained artifact would have no consumer.** Phase 31 exists to serve
  Phase 17's Soul/Character workflows. Phase 17 is `PARTIAL` — its Product
  Intelligence half is implemented, but the Soul/Character capability that
  would consume a LoRA does not exist. A model trained today connects to
  nothing.
- **Recurring GPU spend would open before any revenue-backed consumer
  exists.** There is no checkout, so there is no revenue. Opening a recurring
  training cost in that state runs against Phase 15 Cost Guard's entire
  premise.
- **Phase 22 readiness is real but insufficient on its own.** A working eval
  foundation tells us we *could* measure a trained model's quality. It does
  not tell us anyone needs one.

---

## Decision rule applied

Phase 31 may be `GO` only if **all** of the following hold:

1. Soul/Character is an approved, real product consumer.
2. A real payment/revenue flow exists.
3. GPU/training budget is explicitly defined under Phase 15 Cost Guard.
4. Phase 22 eval foundation is ready.

Conditions 1, 2 and 3 are false. Condition 4 alone is not sufficient.
Result: `NO_GO_DEFER`.

---

## Re-evaluation conditions

Phase 31 may be reconsidered only when **all four** hold:

1. Phase 17 Soul/Character becomes an approved real product capability.
2. Real payment/revenue flow is live.
3. GPU training budget / per-training cost ceiling is approved under Phase 15
   Cost Guard.
4. Phase 22 evaluation foundation remains operational.

**Optional additional trigger:** a concrete product requirement exists that
cannot be satisfied economically through provider aggregation alone.

These are conditions, not a schedule. "When we have time" and "later" are not
re-evaluation triggers and must not be recorded as such.

---

## Future cost / billing ownership — guidance only, not implemented

If Phase 31 is ever reopened, training economics reuse the existing canonical
owners. **A second billing system must not be created.**

Training job charging integrates through Phase 10 (credit/billing ownership)
together with Phase 15 Cost Guard, following the existing reservation
lifecycle:

```
reserve
  → execute training
  → settle actual approved cost
  or
  → refund/release reservation on proven non-execution or failure
```

This mirrors the semantics already implemented for generations. It is
architectural guidance for a future decision, and nothing in it is built now.

---

## AI authority

`AI_PHASE31_GO_AUTHORITY: NONE`

AI/MCP must never autonomously change this decision from `NO_GO_DEFER` to
`GO`. Both of the following are required first, from a human:

- `HUMAN_PRODUCT_APPROVAL_REQUIRED: YES`
- `HUMAN_BUDGET_APPROVAL_REQUIRED: YES`

No MCP or tool path may initiate training from this record. This record
authorises nothing; it declines to authorise.

---

## Status

```
PHASE_31_STATUS:          OPTIONAL_NO_GO_DEFER
PHASE_31_A_STATUS:        PASS (decision recorded)
PHASE_31_B_TO_E_STATUS:   DEFERRED_NOT_TRIGGERED
```

Recorded against the reconciled master roadmap
(`Cinefield_Master_Yol_Haritasi_v1.9.1_RECONCILED_FINAL_2026-08-21.docx`),
whose Phase 31 section this record does not modify.
