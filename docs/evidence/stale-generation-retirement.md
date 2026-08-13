# Stale generation retirement — 91 historical records

Sanitized record of a one-time administrative cleanup on the live database.
Ids, counts, statuses and model names only: no prompt, no email, no display
name, no storage URL, no credential.

```
Date            2026-08-13
Commit before   f66e387
Records audited 91
Records retired 91
Provider calls  0
Financial ops   0
```

## What these records were

Generations left in `queued` between 4 and 7 August, abandoned when the
legacy inline execute route was retired. They predate `workflow_start_outbox`
entirely.

Model ids across the 91: mostly UI-catalog names that never had a server-side
model at all — `recraft-v4-1` (11), `nano-banana` (10), `wan-2-2` (7),
`higgsfield-soul` (5), `test-model` (5), and 26 others. Only three ids were
orchestratable (`nano-banana-pro`, `nano-banana-2`, `nano-banana-2-lite`),
and none of those had reached a provider either.

They were not harmless clutter: anything scanning for unfinished work counted
them as work. The M6 backfill had to be corrected precisely because it marked
them as owed a workflow.

## Evidence gathered before touching anything

| Signal | Result |
| --- | --- |
| `generation_attempts` rows | **0** — none ever reached the provider boundary |
| `provider_job_id` | **0** |
| `metadata.orchestration` | **absent on all 91** — the orchestrator never ran |
| `output_url` / `thumbnail_url` | **0** |
| `temporal_workflow_id` | **0** |
| Temporal `describeWorkflowExecution` for `gen:<id>` | **91/91 NOT_FOUND** |
| `credit_reservations` | **0** (table-wide) |
| `credit_ledger` non-migration rows | **0** |
| `outbox_events` for these aggregates | **0** |

The Temporal check was a live control-plane query against all 91 workflow
ids, not an inference from the null column. It costs nothing and it is the
difference between "no workflow was recorded" and "no workflow exists".

## Classification

```
A SAFE_TO_RETIRE                91
B RECONCILIATION_REQUIRED        0
C FINANCIAL_REVIEW_REQUIRED      0
D ACTIVE_OR_VALID                0
E UNKNOWN                        0
                               ---
                                91  = audited count
```

## Terminal state chosen: `cancelled`

`generations_status_check` allows exactly `queued`, `processing`,
`completed`, `failed`, `cancelled`. **There is no `expired` state**, and
inventing a sixth would be a schema change made to flatter a cleanup script,
so it was not done.

Of the three terminal states:

- `completed` would assert output that does not exist.
- `failed` would assert an execution that never happened, and would pollute
  every error-rate and reliability measurement that reads terminal states.
- `cancelled` is the honest one: the request was abandoned before it ran.

The reason code `stale_retired_never_submitted` distinguishes these from user
cancellations — see the defect below, which had to be fixed first for that to
be possible at all.

## Defect found and fixed during this task

`cancel_generation_tx` has accepted `p_reason` since 20260813, validated it
strictly (`^[a-z][a-z0-9_]{1,64}$`, a code and never a message) — and then
discarded it. It reached neither the row nor the event payload, whose schema
is `additionalProperties: false` with only `generationId` and `provider`.
`status-manager.ts` has been forwarding a reason in good faith the whole time.

Consequence: every cancellation in the database looked identical, whether a
user pressed stop, a workflow gave up, or an operator retired a record. Doing
this cleanup on top of that would have written 91 terminal states nobody
could later distinguish from user intent.

Fix (`20260819000000`): one key in the object the function already builds,
wrapped in `jsonb_strip_nulls` so a reasonless cancel is byte-identical to
before. No new column, no new status, no event-schema change.

## How the retirement ran

`retireStaleGeneration()` gates each candidate and then calls the existing
`cancel_generation_tx` — the same guarded, outbox-emitting transaction every
other cancellation uses. It cannot start a workflow, submit to a provider,
create an attempt, touch credits, or delete a row; tests assert this over its
source.

The gate fails closed. Any attempt, any provider job id, any output, any
Temporal workflow, or any non-stale status refuses the row untouched.

```
AUDITED=91  RETIRED=91  REFUSED=0  ALREADY_TERMINAL=0
```

## Live state after

```
generations              cancelled 91 · failed 45 · completed 38
remaining non-terminal   0
retirement reason stamped 91
generation.cancelled events 91      (durable evidence, one per row)
generation_attempts      1          (unchanged — the 8-A live test only)
credit_reservations      0          (unchanged)
credit_ledger            2          (unchanged — migration opening balances)
workflow_start_outbox    delivered 174, pending 0
```

## Idempotency, proven live rather than argued

The whole retirement was run a second time against the same rows:

```
REPLAY: retired=0  refused_not_stale=91
generation.cancelled events: 91 before -> 91 after
```

No second transition, no second event. `cancel_generation_tx` only moves
`queued`/`processing`, so terminal rows are inert.

The workflow-start relay was then run against the live database:

```
RELAY: {claimed: 0, delivered: 0, failed: 0}
generation_attempts still 1
```

No workflow started, no attempt created, no provider contacted.

## What was NOT done

- No row was deleted. Every generation is preserved for audit.
- No provider was called. No paid call of any kind.
- No credit was reserved, debited, settled or refunded.
- No Temporal workflow was started.
- No new status was invented.
- The retirement path is server-only: it is a module behind the service-role
  admin client, reachable by no browser route.
