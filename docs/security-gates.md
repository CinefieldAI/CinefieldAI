# Security Release Gate — evidence

The roadmap defines twelve mandatory gates before Public Production, and
requires the evidence for them to live in this file. A gate is a control that
must be **proven**, not a bug that has been found: a package being marked done
in code does not close a gate until the claim it makes has been tested.

Stage rules from the roadmap:

| Stage | Gates required |
| --- | --- |
| Closed alpha | none |
| Private beta | 1–6 closed |
| Public production | all 12 closed |

Status vocabulary used below:

- `CODE_CONTROL_IMPLEMENTED` — the control exists in the codebase
- `TEST_EVIDENCE_PASS` — behavioural tests prove it, in this repository
- `LIVE_INFRA_PENDING` — an infrastructure-level control is still missing
- `NOT_STARTED`

A gate is only **CLOSED** when every row it depends on is satisfied. Nothing
below is closed yet.

---

## Gate 3 — Provider output downloads only through the Outbound Fetch Gateway

**Owning package:** 9-E
**Claim:** provider output is downloaded only through the gateway;
private / link-local / metadata addresses are blocked; the redirect chain is
re-validated.

### Status

```
CODE_CONTROL_IMPLEMENTED            YES
TEST_EVIDENCE_PASS                  YES   (37 tests, no real network)
LIVE_INFRA_EGRESS_HARDENING_PENDING YES
GATE 3                              NOT CLOSED
```

### What is implemented

`src/lib/media/outbound-fetch-gateway.ts` is now the single server-side
download boundary for provider results. `src/lib/media/ip-guard.ts` holds the
address policy as pure, testable classification.

Before this, `output-normalizer.ts` called `fetch(providerUrl)` behind a lone
`https:` check — the exact control the roadmap calls insufficient ("Yalnız
https şeması kontrolü YETERSİZDİR"). That path was live: it ran during the
Phase 8-A fal validation.

| Control | Implementation |
| --- | --- |
| Scheme | `https:` only; no silent http→https upgrade |
| URL credentials | userinfo rejected, on the first URL and on every redirect |
| DNS | resolved before connecting; **every** returned address screened |
| IP policy | loopback, RFC1918, CGNAT, link-local, **169.254.169.254**, unspecified, multicast, reserved, IPv6 `::1` / `fe80::/10` / `fc00::/7`, and IPv4-mapped forms of all of the above |
| Rebinding | the socket is pinned to the screened address via a `lookup` override on `https.request` — validation and connection are the same act |
| Redirects | manual, max 3, each hop re-runs scheme + DNS + IP screening |
| Size | `Content-Length` precheck **and** an independent streaming byte counter; default ceiling 64 MiB |
| Timeout | whole-request budget, default 60 s, abortable |
| Errors | failure class only — never the URL, host, path or signed query |

### Residual risk, stated honestly

- **Egress is not restricted at the network layer.** The roadmap's 9-E
  completion criterion is "Media Worker keyfi URL'ye çıkamıyor" — the worker
  *cannot* reach an arbitrary URL. Today it can; it simply refuses to. An
  application-level guard is bypassed by any future code path that opens its
  own socket. The regression test over the provider-result files catches the
  obvious cases and cannot catch every one. **Network-level egress policy and
  minimum IAM remain outstanding 9-E work.**
- **Rebinding is closed for this client, not for the process.** The pinning
  applies to the gateway's own requests. Any other code that resolves and
  connects separately reintroduces the window.
- **Only the first resolved address is used.** If it is unreachable the
  download fails rather than trying the next; all of them were screened, so
  this is a availability tradeoff, not a security one.
- **The gateway does not read the bytes.** See Gate 3's boundary below.

### What this gate does NOT cover

`Outbound Fetch Gateway ≠ Untrusted Media Sandbox.` This control protects the
network destination and the download bounds. Malicious media still reaches
whatever eventually decodes it. The roadmap red note is explicit: "Outbound
Fetch Gateway SSRF'yi sınırlar; ancak kötü niyetli medya
FFmpeg/decoder/parser yüzeyine ulaşır." That containment is **Phase 9-B**,
implemented below — as process isolation, with container hardening still
outstanding.

This batch itself added no parser: no `sharp`, no `ffprobe`, no FFmpeg, no
content sniffing. `Content-Type` is carried as `declaredContentType` — a
provider claim — and deliberately not named `mimeType`. The separate
`verifiedMime` arrived with 9-B and is derived from the bytes inside the
sandbox.

The provider-output lane keeps its roadmap name, **QUARANTINE / OUTPUT
(INGEST)**, distinct from the browser-upload **QUARANTINE / INPUT** lane. Both
exist as storage lanes and asset state from 9-A/9-B; the quarantine RELEASE
workflow is 9-E and is not implemented.

---

## Gate 4 — Presigned upload bounds

**Owning package:** 9-A · 9-B
**Claim:** a presigned upload is limited to one object key, a short expiry, a
maximum size, an accepted MIME declaration and an authenticated workspace; the
user cannot choose the objectKey.

### Status

```
CODE_CONTROL_IMPLEMENTED   YES
TEST_EVIDENCE_PASS         YES   (33 tests)
INGEST_VERIFICATION        SATISFIED  (Phase 9-B landed in 015c3e6)
GATE 4                     CLOSED
```

Every clause of the claim is implemented, tested and — for bucket privacy —
verified live. The one row that held this gate open was the ingest
verification a presign cannot provide; Phase 9-B supplies it, so the gate is
closed here rather than left stale. The CORS gap below is a deployment task,
not an unproven control: it fails closed, since a browser upload from the
production origin is refused at preflight rather than accepted unchecked.

### What is implemented

`POST /api/media/upload-url` issues the only browser upload authorization.

| Requirement | Implementation |
| --- | --- |
| Server-generated key | `buildAssetObjectKey()` from the verified Clerk `userId` and a server-minted asset id. The request body has **no** key, bucket or asset-id field — the shapes do not exist, which is stronger than validating them away. |
| Workspace from session | `auth()` only. `workspace_id` is never read from body or query, as the roadmap requires. |
| Short expiry | 300 s, and `Math.min` prevents a caller asking for more. |
| Max size | 64 MiB, checked before signing. |
| MIME declaration | narrow allowlist, bound into the signature. |
| One key | the signature covers bucket + key + method + content type. |
| No client key control | a hostile filename is reduced to an extension; `../`, absolute paths, NUL tricks and 500-character names all collapse to a safe key inside the caller's own prefix. |
| No shared cache | `Cache-Control: private, no-store, max-age=0` on the presign response — the red note names presigned URL responses specifically. |
| Bucket private | verified live: an unsigned request for a just-written object was refused (HTTP 400) rather than served. |
| Ingest verification | Phase 9-B: bytes are identified and hashed in a sandbox before anything may treat them as media. |

### Residual risk

- **A presign is not validation.** It authorizes bytes at a key; it says
  nothing about what those bytes are. The asset row is created `pending` and
  `quarantined`, and only the 9-B ingest gate (MIME, checksum, duplicate,
  moderation) may advance it. That gate now exists; what a presign alone
  proves is still nothing, which is why the two are separate controls.
- **CORS covers localhost only.** The bucket allows `http://localhost:3000`
  for PUT/GET/HEAD with `Content-Type`. The deployed origin has no rule yet, so
  browser upload from production would fail preflight.

---

## Untrusted media validation and parser sandbox (Phase 9-B)

Not one of the twelve numbered gates, but the control the Gate 3 boundary
explicitly does NOT cover, so its status is recorded here beside it.

```
SANDBOX_CODE_BOUNDARY           IMPLEMENTED
SANDBOX_TEST_EVIDENCE           PASS   (38 tests, synthetic fixtures only)
PRODUCTION_CONTAINER_HARDENING  PENDING
MODERATION_ENGINE               NOT_CONFIGURED
```

### What is implemented

**Verified MIME (M3).** `verified_mime` is derived from the bytes by a
signature reader with no imports, no recursion and no allocation proportional
to input. It is never taken from a response header, a browser Content-Type or
a filename. Executables, scripts, archives, PDFs, Office documents, HTML and
**SVG** are refused by name — SVG because it is active content, not because it
is unsupported. A polyglot whose prefix satisfies both an image and an
executable signature is refused: hostile detection runs first.

**Checksum.** SHA-256 over the real stored bytes, computed inside the sandbox.
Neither a provider-supplied nor a browser-supplied digest is trusted, and a
changed checksum on replay raises `checksum_conflict` rather than overwriting
the recorded one.

**Duplicate detection.** Owner-scoped, evidence only. The lookup filters on
`clerk_user_id` before the hash, the index leads with the tenant, and a
cross-tenant `duplicate_of_asset_id` is refused by a database trigger. No
endpoint accepts or returns a checksum, so there is no hash-existence oracle.

**Sandbox.** A disposable child process, spawned as bare `node` with an
ALLOWLISTED environment of exactly `PATH` and `NODE_ENV`. It receives bytes on
stdin and returns one JSON line; it imports `node:crypto` and the pure
detector and nothing else. No provider key, no Supabase service role, no R2
credential, no Clerk or Temporal secret can reach it — not because they are
deleted, but because the environment is built from nothing. A hard SIGKILL
bounds wall-clock time and the child counts bytes as it reads them.

### Residual risk, stated honestly

- **This is process isolation, not a container.** There is no read-only root
  filesystem, no cgroup CPU or RAM limit, and no network namespace. Those are
  properties of a container runtime and remain production infrastructure work.
  The roadmap's full requirement — "read-only filesystem, CPU/RAM/file-size/
  execution-time limits, restricted egress, minimum IAM" — is therefore only
  partly met.
- **Network isolation is by construction, not by policy.** The child has no
  client and no URL, so it cannot fetch. That argument stops holding the
  moment 9-C introduces FFmpeg, which resolves URLs in playlists, concat lists
  and protocol handlers. A network namespace becomes mandatory then, not
  optional.
- **No moderation engine exists.** The repository's only classifier is text-
  only, behind a disabled flag, and never called by the pipeline. Moderation
  is a contract here: `not_evaluated` is the truth, and the release constraint
  demands `passed`, which nothing can currently produce. **Every asset stays
  quarantined** — fail-closed by construction rather than by convention.
- **Quarantine release does not live here.** Nothing in 9-B can release an
  asset. That lane arrived with 9-E (see below) and needs two administrators
  plus a moderation verdict; the admin surface for it is a Phase 16
  high-risk action and does not exist yet.

---

## Disaster recovery storage (Phase 9-D)

```
CODE_CONTROL_IMPLEMENTED   YES
TEST_EVIDENCE_PASS         YES   (27 tests + 7 PostgreSQL proofs)
LIVE_PROOF                 YES   (R2 -> S3 verified end to end, synthetic asset)
PRODUCTION_IAM_PENDING     YES
```

The DR bucket is private with Block Public Access on, encrypted with SSE-S3,
and versioned. The backup identity (`cinefield-dr-backup`) holds only
`PutObject`, `GetObject`, `ListBucket` and `GetBucketLocation` on that one
bucket — **no `DeleteObject`**, so a backup worker cannot destroy backup
history.

No AWS access key exists in this repository or its environment. Credentials
come from the SDK default provider chain: a named profile locally, the ECS
task role in production. What `.env.local` holds is the profile NAME, the
bucket name and the region — identifiers, not secrets.

### Residual risk

- **KMS is Phase 25.** SSE-S3 is server-side encryption with AWS-managed
  keys. Customer-managed key ownership and a least-privilege key policy are a
  later phase; writing a KMS policy now would be a fiction, since no key
  exists and `infra/modules/kms` has never been applied.
- **Production IAM is not provisioned.** The dev identity is a long-lived IAM
  user with static keys. Production must use the ECS task role instead, and
  `infra/modules/iam` has no DR role yet.
- **DR is dev-scoped.** `cinefield-media-dr-dev` only. A production bucket,
  cross-region placement and a lifecycle policy are outstanding.
- **Restore is a contract, not code.** Nothing can currently restore from S3;
  see the architecture doc for the shape it must take.
- **Nothing schedules the backup pass.** `runDrBackupPass` has no production
  caller: the repository deliberately enables no recurring schedule without
  review (`operational-tasks.ts` uses `task()`, never `schedules.task()`), and
  9-C — which owns the background-job lane — is deferred. The roadmap's
  criterion for 9-D is that *a sample asset's S3 DR copy is verified*, which
  the live proof satisfies; continuous drain is an operations task, not part
  of that criterion. It fails closed: unbacked assets keep
  `backup_status = 'not_backed_up'` and stay counted as debt
  (`countBackupDebt`, `PROOF D4`) rather than being recorded as safe.

---

## Quarantine release lane (Phase 9-E)

```
CODE_CONTROL_IMPLEMENTED   YES
TEST_EVIDENCE_PASS         YES   (30 tests + 7 PostgreSQL proofs + 4 race proofs)
LIVE_SCHEMA_APPLIED        YES   (20260823000000, verified on the linked project)
MODERATION_ENGINE          NONE  — and therefore nothing can be released
```

Every asset created by 9-A/9-B starts `quarantined`. `approve_media_release`,
`request_media_release` and `reject_media_asset` are the only code that
changes that, they are `service_role`-only, and there is no HTTP route to
any of them.

**Two people.** The roadmap lists quarantine release among the actions that
"tek admin onayıyla çalıştırılamaz". Release is therefore a request one
admin raises and a *different* admin approves. The mechanism is the primary
key on `(asset_id, approver_clerk_user_id)`: the same human approving twice
writes the same row, so the count does not move (`PROOF E2`).

**No moderation override.** An administrator has authority to release a
CLEARED asset, never to declare one cleared. Two approvals of an unmoderated
asset still fail with `moderation_not_passed`, and no approval is even
banked (`PROOF E1`). The roadmap authorises releasing cleared media; it
authorises no human override of the verdict itself, so none was built.

**No engine is configured.** `src/lib/media/moderation-contract.ts` defines
the shape a classifier must satisfy and registers nothing. `ModerationVerdict`
has no member meaning "probably fine", so an unimplemented engine cannot
return one — the only thing it can return is `null`, which is not a verdict.
An unknown engine name resolves to `null` rather than to a permissive
fallback. The consequence is visible and intended: **no asset can currently
leave quarantine**, and the delivery gate in `attachSignedUrls` therefore
mints no signed URL for any `media_assets` object.

**But that is not the only way a user sees their output today, and the
distinction matters.** The Supabase Storage mirror described in the
architecture contract is still live: `uploadOutputs` writes the
`generation-outputs` bucket, `generations.output_url` still points at it, and
`src/hooks/useGeneration.ts` mints a signed URL for that path **in the
browser**, which never passes through the 9-E gate. So generated media does
reach its owner without a moderation verdict.

What bounds it:

- the bucket is **private** (`public = false`, verified live) and carries one
  policy, `generation_outputs_select_own` for `authenticated` — owner-scoped
  read, no INSERT for a browser role, no cross-tenant read;
- the URL is short-lived and per-object, not a CDN path.

The roadmap's 9-E criterion is *"moderation tamamlanmadan hiçbir obje public
CDN yoluna çıkmıyor"* — no object reaches a **public CDN** path before
moderation. A private, owner-scoped, expiring URL is not that, so the
criterion holds. The gate claim above is nonetheless scoped precisely to
`media_assets` rather than to "generated media" in general, because the
looser reading would be false.

This mirror is time-boxed by the architecture contract: it goes away when a
read path serves media from `media_assets` (9-C delivery, or the generations
gallery). **That removal is the point at which the delivery gate becomes the
only delivery path**, and it must not be treated as cosmetic cleanup.

**The delivery gate is fail-closed.** It lives inside `attachSignedUrls`
rather than at its call sites, so a future caller cannot obtain a URL by
forgetting the check, and a caller that passes no generation to check
against gets no URLs at all. It is answered by the database immediately
before minting, because a cached `true` would serve media that was rejected
a second ago.

**The audit cannot be revised.** `media_safety_audit` is append-only through
a `BEFORE UPDATE OR DELETE` trigger that refuses every role, including the
one that writes it (`PROOF E5`, `PROOF R4`). It carries short reason codes
matching `^[a-z][a-z0-9_]{1,64}$` — never free text, never a URL, never a
payload.

**Concurrency is decided by the database.** Six simultaneous approvals of a
cleared asset with one approval already banked produce exactly one release
and one event; six simultaneous rejects produce one reject and one event; a
release and a reject arriving together cannot both take effect, and the
emitted event always agrees with the final row state (`PROOF R1`–`R3`).
Replay is inert in both directions.

### Residual risk

- **No moderation engine exists.** Selecting one is a product and cost
  decision, not something an implementation batch should make. Until then
  the release lane is complete but unreachable, which is the safe failure.
- **No admin surface.** The functions are callable only from server code
  with a `ROUTE_ADMIN_CLERK_USER_IDS` allowlist that is currently unset —
  meaning nobody is an admin. An operations UI is a later phase.
- **`INPUT` and `OUTPUT` quarantine remain separate lanes** and must not be
  merged; nothing in this batch merges them.
- **No appeal or reopen flow exists.** Rejection is terminal for the normal
  lane. Pulling released media back is a takedown, which is a
  retention/legal operation (Phase 23), not a moderation reject.

---

## Realtime delivery (Phase 11-B)

```
CODE_CONTROL_IMPLEMENTED   YES
TEST_EVIDENCE_PASS         YES   (32 tests)
LIVE_REDIS_VALIDATION      YES   (adapter -> Redis A -> XREAD round trip, isolated stream)
REDIS_STREAMS_OWNER        REDIS_A
REDIS_B_USED               NO
REDIS_A_NOEVICTION         NO    -- volatile-lru; see MANUAL ACTION below
SSE_REPLAY (11-C)          NOT_STARTED
CONNECTION_LIMITS (11-D)   NOT_STARTED
```

```
Postgres Outbox -> Notification Service -> Redis Streams (Redis A) -> SSE Gateway -> Browser
                                                                          ^
                                                                   11-B ends here
```

**Streams, never Pub/Sub.** The roadmap closed the option because Pub/Sub
provides neither cursor nor replay. A test asserts no `PUBLISH`/`SUBSCRIBE`
appears anywhere in the realtime package.

**Redis A owns realtime; Redis B is untouched.** `BULLMQ_REDIS_URL` is not read
by any file in the package, and a test asserts it.

**The stream key cannot come from a request.** `streamKeyFor` accepts only the
branded `ChannelId` from 11-A, whose sole constructor takes a database-captured
tenant, so a query string cannot reach a Redis key even if a route forgot to
check. The gateway reads no `searchParams`, no body and no identity header —
`?user=`, `?workspace=`, `?channel=` and `?stream=` are not validated away,
they are never read. Verified live: an unauthenticated request is refused in
~20 ms with 401, before any Redis work.

### Retention — two limits, two mechanisms, stated precisely

| Limit | Mechanism | Strength |
| --- | --- | --- |
| ~200 events | `XADD ... MAXLEN ~ 200` on every publish | **APPROXIMATE.** The `~` lets Redis trim only at macro-node boundaries. Verified live: 12 entries written with `MAXLEN ~ 5` left all 12. It bounds growth cheaply; it is **not** a hard cap and is not described as one. |
| 15 minutes | `XTRIM ... MINID <now-15m>-0` on every publish | **EXACT.** Stream ids are `<ms>-<seq>`, so a time-derived MINID is a real boundary. Verified live in both directions: `MINID(now-15m)` retained recent entries, `MINID(now+1s)` removed all of them. |

A key TTL was rejected and gives neither: `EXPIRE` deletes the whole stream at
once, so a quiet channel would lose its entire history rather than its oldest
slice, and an active channel's TTL would keep being pushed out. Redis streams
have no per-entry TTL.

### Publication idempotency — the honest version

`XADD` is not idempotent and cannot be made so: Redis assigns a new stream id
on every append, so an at-least-once outbox retry produces a **second entry**.
This is not disguised. What is guaranteed is the property downstream needs —
**the logical event identity is stable**: both entries carry the same
`eventId`, which is the outbox row's own id and the dedupe identity the event
contract already defines. Verified live: a retried publish produced 2 entries
and 1 distinct `eventId`. No second domain event is created. Entry-level
suppression is 11-C's to decide; stable identity is the part it cannot add
afterwards.

### Connection budget

`SSE_CONNECTION_MAX_AGE_MS = 50_000`, ±10% jitter. No `vercel.json` exists and
no route sets `maxDuration`, so the deployed ceiling **cannot be proven from
this repository**; the budget is set against the most restrictive documented
Vercel default rather than an assumed plan. The gateway ends its own stream and
sends a `reconnect` event first, so the close is deliberate rather than a
platform kill mid-frame. Jitter prevents a deploy's connections from all
returning in the same second. Raising this is one line once the plan's real
ceiling is confirmed.

Heartbeat is a 15 s SSE comment, with a 5 s `XREAD BLOCK` so abort and budget
checks stay responsive.

### Backpressure and resource release

Reads are batched (`COUNT 50`); a slow consumer is closed once queued bytes
exceed 256 KiB rather than buffered indefinitely; the Redis reader is released
from the abort signal, from the stream's `cancel()`, and from the loop's
`finally`. A **dedicated** reader connection is used because ioredis runs
commands in order on one socket — a blocking `XREAD` on the shared application
client would stall idempotency reads, lock acquisition and rate-limit checks
behind a subscriber that is doing nothing.

### Redis failure semantics

A publish failure returns `transport_unavailable` or `transport_failed` and
**nothing else happens**: the adapter never marks an outbox row published, so
the row stays recoverable debt. It imports nothing that could mutate a
generation, retry a provider, settle credits or start a workflow, and a test
asserts those imports are absent. A realtime failure is a delivery failure,
never a generation failure.

### 🔴 MANUAL ACTION REQUIRED — Redis A eviction policy

Live probe of Redis A reports `maxmemory_policy = volatile-lru`, and
`CONFIG GET` is blocked by the provider. Under memory pressure `volatile-lru`
evicts keys **that carry a TTL**, choosing least-recently-used — and Redis A's
TTL-bearing keys are exactly the idempotency records, distributed locks,
rate-limit windows and provider health state that `redis-isolation.ts` exists
to protect. Worse, a busy stream is *recently used*, so an idle lock would be
evicted before it.

This predates Phase 11-B and was not introduced by it, but realtime streams add
memory pressure to the same instance, so it must be resolved before this is
called production-safe.

**Change required (dashboard, by a human — not applied automatically):** set
Redis A's `maxmemory-policy` to **`noeviction`**. Cinefield's Redis A holds
correctness state, not a cache: refusing a write under pressure is recoverable,
silently dropping a lock is not. No configuration was changed by this batch.

### Residual risk

- **Lossless resume does not exist yet.** Events occurring between connections
  are missed. Every consumer must treat realtime as a signal and keep its own
  fetch. `Last-Event-ID` is emitted on the wire but deliberately **not read** —
  honouring it halfway would let a client believe it had resumed. 11-C owns it.
- **No connection ceiling.** One tenant can open as many streams as it likes.
  11-D owns the limit and idle eviction; `cross-tenant SSE` stays in the
  release-blocking set until then.
- **The authenticated browser round trip was not exercised end to end.** It
  requires an interactive Clerk sign-in. What is proven: the 401 refusal live,
  the adapter -> Redis A -> XREAD round trip live with envelope integrity, and
  the framing, headers, mapping and boundaries by test.

---

## Notification routing (Phase 11-A)

```
CODE_CONTROL_IMPLEMENTED   YES
TEST_EVIDENCE_PASS         YES   (29 tests + 9 PostgreSQL proofs + 4 race proofs)
LIVE_SCHEMA_APPLIED        YES   (20260824000000, verified on the linked project)
REDIS_STREAMS              NOT_STARTED   (11-B)
SSE_GATEWAY                NOT_STARTED   (11-B / 11-C / 11-D)
```

The canonical Phase 11 path, from the roadmap's binding diagram correction:

```
Postgres Outbox -> Notification Service -> Redis Streams -> SSE Gateway -> Browser
                          ^
                   11-A ends here
```

**Only the first arrow exists.** Redis Streams and SSE are 11-B and later; no
module in this batch imports a Redis client or emits an event stream, and the
tests assert that absence rather than trusting it.

**The event contract had drifted, and now cannot again.** Phase 9-E emitted
`media.asset.released` / `media.asset.rejected`. `emit_outbox_event` checks
only that a type is non-empty; the real rules — two dotted segments, a known
family, a registered schema — live in TypeScript, so both events were
unroutable (`familyOf()` returned null, and a producer that cannot resolve a
topic must refuse to publish). They are renamed to the canonical `asset.*`
family. `phase-11a-event-contract-guard.e2e.test.ts` now reads every
`emit_outbox_event` literal out of the migrations and resolves it through the
same three checks a consumer performs, so SQL and TypeScript can no longer
drift apart silently. The guard resolves each function's **effective**
definition the way PostgreSQL does — last `CREATE OR REPLACE` wins — and
proves that resolver works rather than assuming it.

Zero historical rows were affected: the live outbox held 91
`generation.cancelled` and 1 `generation.completed` and no `media.*` at all,
so there was nothing to translate and nothing that could double-deliver.

**The channel is derived, never supplied.** The roadmap forbids
`/events?workspace=...` outright, so no function accepts a channel from a
request. `ChannelId` is a branded type whose only constructor takes a tenant
the database captured; a user id read from a request body cannot be passed
where a channel is expected, and the compiler enforces it.

**Tenant capture, not tenant lookup.** `outbox_events.tenant_id` is written
inside the emitting transaction by `emit_outbox_event`, from the row the
caller has just written or locked. Resolving it later by joining the aggregate
was rejected: routing would then depend on mutable state, and
`generations.clerk_user_id` cascades from `profiles`, so a deleted profile
would make every historical event permanently unresolvable. The signature is
unchanged, so the six existing producers gained capture without being
rewritten — `PROOF N8` verifies that actually happened.

**NULL refuses; it never broadcasts.** The column is nullable and NULL means
"not captured". The Notification Service returns `unroutable` and publishes
nowhere — there is no fallback, global or admin channel, and a test asserts
none exists anywhere in the three modules. The 92 pre-existing rows carry NULL
and are therefore refused rather than misrouted.

**Payloads are copied field by name, never spread.** `outbox_events.payload`
is unrestricted jsonb written by SQL. A spread would publish every field a
future emitter adds, unreviewed. Each projector names its two or three fields;
a test asserts no spread exists and that no object key, signed URL, secret,
prompt, stack trace or approver identity can appear in an envelope.

**Asset safety events are deliberately not user-facing.** `asset.released` and
`asset.rejected` validate and route but project to nothing: approver
identities and reason codes are security data, `media_safety_audit` is
service_role only, and Phase 12 owns the user-facing security taxonomy.

**`credit.updated` is a registered state with no producer.** Phase 10 owns the
ledger. This batch adds no credit emitter and a test asserts the migration
contains none.

### Residual risk

- **11-C's ordering decision is deliberately open.** The envelope carries
  `eventId` (already the at-least-once dedupe identity) and no `seq`. A Redis
  Stream entry id is monotonic per stream and channel maps to stream, so it is
  a strong CANDIDATE for the roadmap's `event_seq` — recorded as a candidate
  only. Declaring it here would lock the architecture before 11-C weighs it
  against replay-window trimming.
- **Nothing drains the outbox yet.** `drainOutboxOnce` still has no scheduler,
  by the same no-silent-cadence rule as the DR pass. The Notification Service
  is a pure function awaiting a caller.
- **No connection limits exist** because no connection exists. 11-D owns them,
  and `cross-tenant SSE` remains in the release-blocking set.

---

## Phase 9 closure — what is deferred, and how each fails closed

Phase 9 closes with 9-A, 9-B, 9-D and 9-E implemented and proven. The
roadmap's phase criterion is that the *active/mandatory* packages are done
and each "bitti sayılma kriteri" is verified. These remain open, and each one
is listed with the reason it cannot become an unsafe default.

| Deferred | Owner | Fails closed because |
| --- | --- | --- |
| **9-C** — SQS→FFmpeg critical finalization + BullMQ/Redis B derived media | Phase 9-C (Redis B unprovisioned) | No FFmpeg dependency exists, no derived variant is ever written, and no media job is enqueued — the only `queue.add` in the tree is a synthetic foundation test. There is therefore no derived-media job that could fail, and nothing that could re-trigger a generation, a provider call or a credit movement. |
| Real moderation engine | product/cost decision | The registry is empty and `null` is not a verdict, so `moderation_status` stays `not_evaluated` and both the SQL constraint and `approve_media_release` refuse a release. **No engine means no release.** |
| Admin surface for release/reject | Phase 16 | No HTTP route reaches the release functions, and `ROUTE_ADMIN_CLERK_USER_IDS` is unset, so `assertRouteAdmin` denies everyone. Absent configuration denies rather than permits. |
| Production egress hardening (Gate 3) | Phase 12/18 infra | The application-level gateway blocks private, link-local, loopback and metadata addresses and re-validates every redirect hop; the missing piece is network-level enforcement, which can only widen defence, not narrow it. |
| Production IAM task role, KMS | 12-D · 25-A | The DR identity holds no `DeleteObject`, so the worst a compromised backup path can do is write. |
| DR restore | later phase | Absent — and no read path consults `backup_key`, so S3 cannot silently become canonical. |
| Takedown / appeal / reopen | Phase 23 | Rejection is terminal and no reopen path exists; a released asset cannot be "un-released" by the moderation lane, which is the safe direction to be missing. |

## Gates not yet addressed

| Gate | Subject | Package | Status |
| --- | --- | --- | --- |
| 1 | Cross-workspace isolation incl. assets and presigned URLs | 12-B | NOT_STARTED |
| 2 | Provider webhook signature, replay, event-id uniqueness | 6R-B · 8-FRAMEWORK | EXTERNAL_PENDING — fal publishes no verifiable signing scheme |
| 5 | Settlement uniqueness guaranteed at DB level | 10-B | Constraint exists (`PROOF S`/`PROOF T`); gate not formally claimed |
| 6 | SQS IAM least privilege; worker distrusts queue messages | 6R-C · 18-A | NOT_STARTED |
| 7–12 | — | — | NOT_STARTED |

## Release-blocking security test set

The roadmap names it: SSRF, IDOR/BOLA, webhook replay, billing race,
duplicate SQS delivery, cross-tenant SSE.

```
SSRF                     PASS  (9-E minimum)
media moderation gate    PASS at DB level (PROOF E1-E7, R1-R4); no engine yet
IDOR / BOLA              NOT_STARTED
webhook replay           NOT_STARTED
billing race             PASS at DB level (PROOF R/S/T/U)
duplicate SQS delivery   NOT_STARTED
cross-tenant SSE         NOT_STARTED
```
