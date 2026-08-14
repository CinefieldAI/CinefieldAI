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

## Realtime dispatcher — the arrow that was missing (Phase 11 closure)

```
D-11-1 OUTBOX -> NOTIFICATION GAP   CLOSED
DISPATCHER OWNER                    long-running worker (worker/realtime-dispatcher-worker.ts)
MULTI-SINK DELIVERY                 separate lanes, proven independent
END-TO-END PROOF                    PASS (real Postgres + real dispatcher + real Redis A)
PRODUCTION DEPLOYMENT               INFRA_PENDING (no ECS provisioned)
REDIS_A_NOEVICTION                  DEFERRED_PRODUCTION_HARDENING
```

### What was actually wrong

Every link of `Outbox -> Notification Service -> Redis Streams -> SSE ->
Browser` was built and proven, and **nothing joined the first two**. Two
distinct gaps: no production code called `drainOutboxOnce`, and
`drainOutboxOnce` targets Kafka anyway — so no code path existed from a
committed fact to a browser. Measured before the fix: **92 events pending,
`ever_published = 0`, oldest 22 hours**. Phase 11 was component-complete and
end-to-end dead.

Every component test still passed, because no test asked whether anything
called the components. That guard now exists
(`phase-11-closure-dispatcher.e2e.test.ts`): it walks the source tree and
fails if the Notification Service or the stream adapter has no production
caller, and if that caller is not in `worker/`.

### Multi-sink: the blocker found before implementing

`outbox_events` was built for exactly one delivery — one `status`, one
`published_at`, one `claim_token`, and an index on `status <> 'published'`.
Overloading it would have produced a silent correctness bug in whichever
direction ran first: Kafka marking a row published makes it **invisible to the
realtime claim forever**, and the user never receives the notification.

So the lanes are separated. The existing columns keep their exact meaning and
are now explicitly the **Kafka lane**; a parallel `realtime_*` set carries the
realtime lane with its own claim, attempts, error and completion. Additive
only: no column dropped, no constraint relaxed, and `claim_outbox_events` /
`mark_outbox_event_published` untouched, so every earlier proof still
describes them accurately.

A generic `outbox_deliveries(event_id, sink, ...)` table was rejected as the
wrong amount of machinery: two sinks exist, both known by name, and a join on
the hottest path buys nothing a second partial index does not. When email/push
genuinely arrives there will be a third case to design against instead of an
imagined one.

`PROOF RD1`/`RD2` prove independence in both directions, and the live schema
confirms it: after the closure the realtime lane reads `92 done/retired` while
the Kafka lane still reads `92 pending`.

### Publication order is the correctness argument

```
claim -> validate/project -> XADD -> resolve('published')
```

and never claim -> resolve -> publish. A crash between the XADD and the
resolve leaves the row owed, so the next pass republishes it — a second
transport entry carrying the SAME `eventId`, which 11-C's client dedupe
absorbs. At-least-once is chosen deliberately: exactly-once would need a
distributed transaction across PostgreSQL and Redis, while the stable identity
11-A/11-B preserve makes the duplicate harmless. The alternative — mark first,
publish second — loses the event silently and forever, with the database
confidently reporting success.

### Four dispositions, never collapsed

| Disposition | Terminal | Why |
| --- | --- | --- |
| `published` | yes | Redis accepted it |
| `not_user_facing` | **yes** | a valid event with no browser projection (asset safety, provider internals). Retrying a correct decision forever is a busy loop wearing the costume of reliability. |
| `unroutable` | **yes**, and visible | no provable tenant. Never broadcast, never a fallback channel, never guessed. Terminal because the condition is structural: a tenant is captured at emit time or not at all. Counted so an emitter that forgot is visible rather than retried into silence. |
| `invalid` | **yes** | redelivering a malformed event reproduces it identically forever. Evidence preserved in the row. |
| transport failure | **no** | released back to pending with the attempt already counted. Never marked delivered — Redis being unreachable leaves recoverable debt, which is the entire reason the outbox exists. |

### Historical debt

92 rows predating tenant capture were retired with disposition `retired` and
reason `pre_realtime_untenanted` — **not deleted**. All were untenanted, so
the Notification Service would have refused them as `unroutable` anyway and
nothing would have been broadcast. This was an *observability* fix, not a
safety one: a debt metric that opens at 92 unroutable rows makes the first
genuine unroutable event one line in a hundred that everybody has learned to
ignore. A signal that starts at ninety-two is not a signal.

The retirement is narrow (untenanted AND older than the migration) and refuses
to have touched the Kafka lane.

### Ownership

The dispatcher owns delivery and nothing else. It cannot create a generation,
start a workflow, submit or retry a provider, move credits, release quarantine
or mint a URL — it imports nothing that could, and a test asserts those imports
stay absent. It does not re-derive projection or tenant logic; it calls the
canonical Notification Service and stream adapter.

It runs as a **separate process** rather than inside the Temporal or provider
worker. Hosting it there would couple three unrelated ownerships to one
lifecycle: a Redis outage crashing the dispatcher would take down provider
submission, which is the money path. Losing realtime is a degraded UI; losing
provider submission is a failed paid generation. Different blast radii deserve
different processes.

### Crash and recovery, proven

`PROOF RD3`–`RD6` on real PostgreSQL: a live lease is not re-claimable; an
expired lease recovers and counts the attempt; a stale dispatcher cannot
resolve or release a row a new owner holds; a transport failure returns the
row without ever marking it delivered. `PROOF DR1`/`DR2`: 16 events claimed
exactly once across concurrent dispatchers, with the Kafka lane untouched.

### End-to-end proof

Real Postgres (all 19 migrations) + the real dispatcher + real Redis A:

```
business transaction -> outbox row (tenant captured) -> dispatcher
  -> Notification Service -> Redis Stream -> gateway resume logic -> browser state "queued"
```

`eventId` stable, channel correct, cursor well-formed, no prompt/objectKey/
signedUrl/secret on the wire, realtime lane `done/published`, **Kafka lane
still `pending`**, second pass inert, debt clean.

### Observable debt

`realtime_outbox_debt()` returns counts and ages only — pending, dispatching,
oldest age, max attempts, and a count per disposition. No payload, no tenant,
no event id: an operational metric that carries a user's content is a data
leak with a dashboard in front of it. Phase 13 owns observability; this is the
shape it can read.

### Deployment

`npm run realtime:dispatcher` runs it. Production target is long-running
ECS/Fargate compute alongside the existing Temporal and provider workers.
**No ECS was provisioned and no AWS infrastructure was created.** Contract:
SIGTERM/SIGINT drain the in-flight pass then exit; restart is safe because
recovery is lease-expiry based, not heartbeat based; the only environment it
needs is the Supabase service role and `REDIS_URL`.

```
DISPATCHER_PRODUCTION_DEPLOYMENT: INFRA_PENDING
```

### Residual risk

- **Nothing runs the dispatcher yet in any deployed environment.** The code,
  the entry point and the proof exist; the container does not. Until it runs,
  the chain is proven but idle — which is a deployment task, not a design gap.

  The canonical runtime path IS proven, not merely the harness: the production
  admin client and the real dispatcher were run against the LIVE project and
  LIVE Redis A on a synthetic tenant, publishing `generation.created` to a real
  stream, mapping to browser state `queued`, with the second pass inert and the
  synthetic data removed afterwards. What remains is a container that calls it
  on a loop.
- **A credential blocker was reported here and was WRONG. Corrected.** The
  closure batch recorded that `SUPABASE_SERVICE_ROLE_KEY` was rejected and
  that the project had disabled legacy JWT keys. Neither is true, and the
  claim came from over-reading a single 403.

  What actually happened: the throwaway harness tried
  `INSERT INTO projects` as `service_role`, and on this schema `service_role`
  holds only `SELECT, REFERENCES, TRIGGER, TRUNCATE` on `projects` — DML there
  belongs to `authenticated`, because projects are created by the browser
  under RLS and the server only ever reads them for ownership checks. No
  server-side code inserts a project, so the grant layout is correct by design.

  The key is valid and is service_role. Proven directly: an admin read of
  `outbox_events` succeeds, and `anon`/`authenticated` have no `SELECT` on
  that table at all, so only `service_role` could have returned it. The
  dispatcher's own RPCs — `claim_realtime_outbox_events` and
  `realtime_outbox_debt` — both execute against the live project.

  No key was created, rotated or changed at any point.
- **Redis A is still `volatile-lru`.** See the sections above; unchanged.

---

## Gate 1 — Cross-workspace isolation, realtime portion (Phase 11-D)

**Owning package:** 11-D (the SSE portion of Gate 1; 12-B owns the rest)

```
TENANT_BINDING                  PROVEN
REPLAY_TENANT_SCOPE             PROVEN
CONNECTION_LIMITS               IMPLEMENTED + LIVE-PROVEN
DISTRIBUTED_LEASE               IMPLEMENTED + LIVE-PROVEN
CROSS-TENANT SSE (release set)  CLOSED for the SSE surface
PRODUCTION_COUNTER_DURABILITY   DEFERRED  -- Redis A is volatile-lru
```

### Principal to membership to effective tenant

The chain the roadmap names exists as a real seam. What it resolves to today is
narrower than the words suggest, and that is stated rather than dressed up:

**There is no workspace.** No `workspaces` table, no `workspace_id` column in
any migration, no Clerk organization — two pre-existing tests assert that
absence deliberately. `clerk_user_id` is the tenant key on `projects`,
`generations`, `media_assets`, `credit_wallets` and every RLS policy.

So membership is the **identity relation**: a principal is a member of exactly
one tenant, itself. `resolveEffectiveTenant` performs that resolution
explicitly and returns `workspaceId: null`. A membership table was **not**
invented — a fake membership check returns a fake answer, and a boundary built
on one is worse than an honest narrower boundary. When workspaces become real,
the function gains a lookup and every caller is unchanged, because all of them
already treat the result as opaque and already refuse to re-resolve it.

### The binding is immutable

Resolved once, before the response body exists, captured in a `const`, never
reassigned. The stream key is derived from it **before** `Last-Event-ID` is
read. Verified live: `?workspace=`, `?user=`, `?channel=` and `?stream=` all
return 401 exactly as the bare path does, because none of them is read at all —
they are not validated away, they do not exist as inputs.

Replay uses the same single key as live delivery — one `const streamKey`, and a
test asserts every `xrange`/`xread` call references it.

### Connection ceilings

| Scope | Limit | Why this number |
| --- | --- | --- |
| user | **4** | a workspace tab, a preview tab, a second monitor, one stale tab the browser has not reaped. Beyond that is not a usage pattern worth serving. |
| workspace | **24** | a team's shared ceiling. **Inert today** — no workspace scope is emitted because no workspace id exists. The machinery is real and tested with a synthetic workspace; only the input is missing. |
| IP | **12** | one NAT may hold several accounts. Above the user ceiling so co-located users are not penalised, low enough that one host cannot open hundreds. |

### The lease, and why it is not a counter

Serverless invocations share no memory, so a process counter would permit the
ceiling **per instance** and reset on every cold start. Slots live in Redis A as
**one sorted set per scope**, members are lease ids and scores are absolute
expiry timestamps. That single choice answers three problems at once:

- **counting** — `ZCARD` after dropping expired members
- **crash safety** — a died instance never releases, but its score is in the
  past, so the next acquire evicts it. No slot leaks, no reaper process.
- **idle eviction** — refresh pushes the score forward; a connection that stops
  refreshing falls out on its own.

An `INCR`/`DECR` counter would have neither: a lost `DECR` is a slot lost
forever.

`ZCARD`-then-`ZADD` from application code is a TOCTOU race, so acquire, refresh
and release are each a **single Lua script**. Verified live against Redis A:
**40 concurrent acquires against a limit of 3 admitted exactly 3.** Release
freed a slot, an aged-out lease was reclaimed, and `ZADD XX` refused to
resurrect a lease that had gone — re-adding would let a stalled connection
exceed a ceiling it no longer holds a slot in.

The lease id is a server-minted v4 UUID. It never leaves the server, carries no
user id, tenant, address or secret, and the browser cannot supply, guess or
influence it.

### IP handling

`x-forwarded-for` is client-writable and a proxy **appends** rather than
replaces, so its first entry is whatever the client claimed. Trusting it would
hand anyone unlimited buckets. Order of preference: `x-vercel-forwarded-for`,
then `x-real-ip`, then the **last** hop of `x-forwarded-for` — never the first.
No trustworthy address means **no IP scope at all**, not one shared bucket every
unknown client contends for.

Addresses are normalised so one host cannot occupy several buckets (IPv4-mapped
IPv6 collapses, zone ids and ports are stripped) and then hashed. The key holds
a hash; the address is never stored or logged. That is bucketing, not
anonymisation — the real protection is that the address goes nowhere.

### Refusal and backoff

`429` with `Retry-After: 30` and a fixed string. No count, no limit value, no
scope, no id — a client learning that the *IP* ceiling rather than the *user*
ceiling was hit would learn something about the other people behind its NAT.

The browser treats 429 as a ceiling, not a transport error: a floor of 20 s, at
least whatever `Retry-After` asks, plus jitter. Retrying a refusal on the 500 ms
transport schedule would turn one over-eager tab into a flood against the
control that refused it.

### Failing closed

An unreachable counter **refuses** the connection. A DoS control that switches
itself off during an outage is not a control, and the outage is exactly when the
ceiling matters. Realtime degrades; the product does not, because the browser
falls back to its authoritative fetch and the outbox still holds every fact.
Nothing in the path can mutate a generation, retry a provider, restart a
workflow or touch credits — asserted by import scan, not assumed.

### Session

No connection outlives the 11-B budget, so `auth()` runs again on every
reconnect. There is no long-lived auth bypass: an expired session simply fails
the next connection.

### DEFERRED PRODUCTION HARDENING — the counter shares Redis A's policy

Redis A remains `volatile-lru` by the user's deliberate deferral. Leases are
TTL-bearing sorted sets, so under memory pressure they are **eviction
candidates**. An evicted lease does not grant extra connections — the refresh
detects its absence and closes the connection — but it does mean the *count* can
under-report, so the ceiling could admit more than its nominal value during
pressure.

```
11-D CODE / LIMIT LOGIC              PASS
PRODUCTION COUNTER DURABILITY        DEFERRED
```

Required later, by a human: set Redis A `maxmemory-policy` to `noeviction`, then
re-run the live limit validation. **No configuration was changed by this batch.**

### Gate 1, honestly scoped

The cross-tenant SSE item in the release-blocking set is **closed for the SSE
surface**: binding proven, replay scope proven, no client-selected stream
authority, connection limits implemented and live-proven. Gate 1 as a whole also
covers generation, attempt, asset, reservation, ledger and presigned-URL
objects, which belong to 12-B and remain open. This section closes the realtime
portion only, and the counter's production durability is deferred above.

---

## Replay and resume (Phase 11-C)

```
CODE_CONTROL_IMPLEMENTED   YES
TEST_EVIDENCE_PASS         YES   (31 tests; 93 across 11-A/B/C)
LIVE_REPLAY_VALIDATION     YES   (resume-after-cursor, dedupe, gap, real trim)
REDIS_A_NOEVICTION         DEFERRED_PRODUCTION_HARDENING
PRODUCTION_REPLAY_DURABILITY  DEFERRED  -- see below
CONNECTION_LIMITS (11-D)   IMPLEMENTED (see above)
```

### The two identities, and why there are two

| Value | What it is | What it is for |
| --- | --- | --- |
| `eventId` | the outbox row's id, stable across at-least-once retries (11-A/11-B) | **dedupe** |
| Redis stream id | `<ms>-<n>`, assigned by `XADD`, per-channel monotonic | **`event_seq`**: order, resume cursor, staleness |

Roadmap 11.6 asks for a per-channel monotonic `event_seq` echoed back as
`Last-Event-ID`. The **Redis stream id was chosen to be that sequence**, and
the reasoning is recorded in `stream-cursor.ts`: it is already monotonic per
stream, assignment is atomic inside `XADD`, `XRANGE (cursor +` answers "after"
natively, and the retention boundary is itself a stream id so "is this cursor
still in the window" is one comparison. A separate counter would need a Lua
script to stay atomic with the append, its own index to support resume, and
its own mapping to answer the window question — and it could desynchronise
from the stream, producing a phantom gap.

What the decision does **not** do is conflate the sequence with identity. A
duplicate publication produces two stream ids for one `eventId`. Roadmap 11.8
says the client "event_seq ile dedupe eder"; deduping by seq alone would miss
exactly that case, so dedupe is by `eventId` and ordering is by seq. Both are
used, for the two jobs they are each good at.

### Replay completeness is proven or refused — there is no third answer

`decideResume` returns `replay` **only** when the client's cursor is still
inside the retained window. If the oldest retained entry is newer than the
cursor, whatever sat between them has been trimmed and completeness cannot be
established, so the answer is `reconcile` and the client refetches
authoritative state. Roadmap 11.7 asks for exactly this: *"Pencere dışında
reconnect olan client replay yerine tam state resync yapar."*

Reconcile reasons: `invalid_cursor` (malformed header), `cursor_too_old`
(trimmed), `window_unknown` (empty or unreadable stream), `replay_truncated`
(the per-resume cap was reached). **No business event is ever synthesized to
fill a gap.**

Replay is bounded twice: `COUNT 100` per `XRANGE`, and `REPLAY_MAX_EVENTS`
across the whole resume. Reaching the cap emits `reconcile` rather than
silently truncating.

### The cursor is a position, never an authority

`Last-Event-ID` arrives in a browser-controlled header. It is length-bounded
before it meets a regex, parsed to `<ms>-<n>`, and can only move a reader
within the ONE stream the session already resolved — the key is computed from
`channelForTenant(userId)` **before** the header is read, and no code path
concatenates a cursor into a key. Replayed entries therefore pass the same
tenant filter as live ones by construction, which is roadmap 11.10.

### Idempotent apply — three defences, because they catch different things

1. **`eventId` dedupe** — the same logical event twice. Bounded to the 500 most
   recent ids in an insertion-ordered set; an unbounded `Set` in a tab left
   open for a day is a leak.
2. **seq staleness** — an older cursor arriving after a newer one, the
   "geriye dönük event yok sayılır" rule.
3. **rank floor** — `completed`/`failed`/`cancelled` never regress to
   `processing`. This is the one that still works after a reconcile, because
   authoritative refetched state deliberately carries **no** seq: it answered
   "what is true now", not "what happened at cursor X".

Terminals are mutually exclusive in the database, so the first terminal to
arrive stands even if a later cursor disagrees.

### Reconnect

The client is `fetch` + a stream reader rather than `EventSource`. `EventSource`
sends `Last-Event-ID` only on its own internal reconnects, and 11-B's hook
closed the source and built a new one on every planned max-age close — so a
fresh instance had no cursor and every reconnect silently resumed live.
**That was a real defect and 11-C fixes it.** `fetch` also allows what
`EventSource` cannot: bounded exponential backoff with full jitter (500 ms
base, 30 s cap), reset after a connection survives 10 s, and a 45 s idle abort
for silently dropped paths.

Heartbeats are comment frames: no `id:`, no `data:`, so they advance no cursor
and enter no dedupe set. `ready`, `resumed`, `reconcile` and `reconnect` carry
no `id:` either — only `notification` frames do.

### 🟠 DEFERRED PRODUCTION HARDENING — Redis A eviction policy

Redis A still reports `maxmemory-policy = volatile-lru`. The user has
**deliberately deferred** this change to a later production-hardening pass; no
configuration was touched by this batch and none should be.

The consequence must not be understated. Under memory pressure `volatile-lru`
evicts TTL-bearing keys by least-recent-use, and a replay window that is
evicted mid-flight becomes a gap. The gap will be **detected** — `decideResume`
returns `cursor_too_old` or `window_unknown` and the client reconciles, so
correctness holds — but the window's *durability* does not, and reconnects
would silently degrade into refetches.

Therefore:

```
11-C CODE / REPLAY CONTRACT      PASS
PRODUCTION REPLAY DURABILITY     DEFERRED
```

Required later, by a human, in the Redis dashboard: set `maxmemory-policy` to
**`noeviction`**, then re-run the live replay validation. Until then Phase 11
is not production-ready, and this document does not claim otherwise.

### Residual risk

- **No connection ceiling.** 11-D owns per-user/workspace/IP limits and idle
  eviction. Both landed in 11-D; see the Gate 1 section above.
- **Multi-tab is per-connection.** Each tab holds its own connection, cursor
  and dedupe set, so their semantics are independent and correct. Nothing is
  shared across tabs — deliberately, since a shared cursor would weaken the
  per-connection tenant binding for no benefit. The cost is N connections per
  user, which is exactly what 11-D bounds.
- **The authenticated browser round trip is still not exercised end to end.**
  It needs an interactive Clerk sign-in.

---

## Realtime delivery (Phase 11-B)

```
CODE_CONTROL_IMPLEMENTED   YES
TEST_EVIDENCE_PASS         YES   (32 tests)
LIVE_REDIS_VALIDATION      YES   (adapter -> Redis A -> XREAD round trip, isolated stream)
REDIS_STREAMS_OWNER        REDIS_A
REDIS_B_USED               NO
REDIS_A_NOEVICTION         NO    -- volatile-lru; see MANUAL ACTION below
SSE_REPLAY (11-C)          IMPLEMENTED (see above)
CONNECTION_LIMITS (11-D)   IMPLEMENTED (see above)
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
- **Connection ceilings arrived in 11-D.** When this section was written a
  tenant could open as many streams as it liked; the per-user, per-IP and
  (inert) per-workspace limits and idle eviction now live in the Gate 1
  section above.
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
- **The outbox realtime drain now has an owner** (see the dispatcher section above). `drainOutboxOnce` — the KAFKA drain — still has no scheduler,
  by the same no-silent-cadence rule as the DR pass. The Notification Service
  is a pure function awaiting a caller.
- **No connection limits exist** because no connection exists. 11-D owns them,
  and the realtime portion of that gate closed in 11-D; see Gate 1 above.

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
| 1 | Cross-workspace isolation incl. assets and presigned URLs | 11-D / 12-B | SSE surface CLOSED (11-D); assets, reservations and ledger open (12-B) |
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
cross-tenant SSE         PASS  (11-D: binding, replay scope, connection limits)
```
