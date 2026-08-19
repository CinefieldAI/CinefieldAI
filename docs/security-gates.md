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

## Distributed trace propagation + span standard (Phase 13-A, code half)

```
TRACE AUTHORITY              ONE generator, server-minted
W3C TRACEPARENT              parsed strictly; INBOUND UNTRUSTED by default
HTTP PROPAGATION             all 14 routes, at the existing common boundary
DURABLE PROPAGATION          Temporal history · SQS wire · outbox · security events
SPAN STANDARD                12 closed low-cardinality names
SPAN ATTRIBUTES              through the 13-E Sensitive Data Guard
EXTERNAL EXPORTER            NONE
SENTRY / OTLP                NOT CONFIGURED
MIGRATION                    NONE — trace_id already existed
```

### The criterion, and what satisfies it

¶1711: *"Tek generation trace_id ile API→worker→provider zincirinde
izleniyor."* One generation, one trace id, followed across API → worker →
provider. ¶1731 asks for the OpenTelemetry trace/span **standard** — naming,
attributes and propagation — which is achievable with no exporter, no DSN and
no account. That is why this half shipped first; ¶1710's Sentry half waits on
an account.

¶1157 asked for the same shape at the 6R foundation, and the plumbing was
built then: the command wire, the domain event, the outbox and 54 places in
the database all carried `trace_id`. **Nothing ever put a value in.** 13-A
mints it.

### One generator, and a trace is never an authority

There is exactly one function that creates a trace id. Two generators means
two formats, and the first time they meet in a query the correlation silently
returns nothing — which reads as "no activity" rather than as a bug.

A trace id arrives, in part, from a header. So it may never choose a tenant,
select a Redis stream, authorize a generation, act as an idempotency key or
become a billing identifier. Each is asserted separately, because "we would
never do that" is not a control. The policy input has **no trace field at
all**, so the 12-E gate cannot be steered by one even deliberately.

### Inbound traceparent is NOT trusted by default

`resolveTraceContext` parses W3C `traceparent` strictly — version `00` only,
32/16 lowercase hex, no all-zero ids, length-bounded before any regex runs —
and a malformed header is discarded rather than repaired. Salvaging half of
one would let a caller control part of an identifier that appears in operator
dashboards.

**But even a VALID header is ignored today.** `trustInbound` defaults to
false: every request arrives from a browser, and a browser-supplied trace id
is attacker-controlled text. Trust is a per-boundary decision, so when 12-A's
Cloudflare edge or an internal service exists, one call site flips.

`origin` records which happened — `inherited`, `minted` or `rejected` — so an
operator can tell "nobody sent a trace" from "somebody sent a broken one".

### The HTTP edge is the boundary that already existed

`guardRoute` is called first by all 14 API routes, so the trace is bound
there — no wrapping of 14 handler bodies, no traceparent parsing duplicated
per route. It uses `enterWith` rather than a callback because the guard
RETURNS before the handler body runs; concurrent-request isolation was
verified before this was relied on.

It cannot affect the guard's decision: minting is a random draw that does not
fail, it reads no field the limiter uses, and the limiter consults nothing it
produces. A test asserts the trace is bound BEFORE the limiter and that the
limiter never reads one.

### The async scope stops at every durable boundary — deliberately

`AsyncLocalStorage` makes the trace ambient inside one process, which is what
gives all 25 logger-migrated modules correlation without touching a call
site. It does **not** cross SQS, Temporal, an outbox row or a worker restart,
and code that assumed it did would break traces exactly where a distributed
trace is most useful.

So every durable hop carries the id as a FIELD:

| Hop | Carrier | Durability |
| --- | --- | --- |
| Temporal | `GenerationWorkflowInput.traceId` | workflow history — survives replay and restart |
| SQS | `CommandEnvelope.traceId` | already on the wire contract |
| outbox | `outbox_events.trace_id` | already a column |
| security | `security_events.trace_id` | already a column |

The provider worker RESUMES from the wire field, validating it on the way in
— a queue message is not an authority (6R.22) — and an unusable value yields
a fresh trace rather than a broken one. A workflow never mints: a random
value inside a workflow breaks deterministic replay.

### traceId and correlationId

Two names existed for one concept. They now hold the same value: the ambient
trace, unless a caller supplies its own. The FIELD NAMES stay — renaming
`correlationId` would touch 12-E's contract and its recorded decisions, and
**historical evidence is not rewritten to tidy a name**.

### Security events: correlated when a request exists, never faked

A signal raised while handling a request inherits that trace. One raised by
the dispatcher loop, a scheduled job or a worker startup does not — those
have no request behind them, and minting an id for them would fabricate a
correlation that never existed. Absence is a legitimate, expected state.

### Span names are low-cardinality; identifiers are attributes

A span name is a dimension key in every backend that will consume this. A
generation id in one produces a series per generation — an unusable dashboard
and an observability bill. Worse, a name containing a user id or a prompt
would be sensitive data in the one field no sanitizer inspects, because names
are structure rather than payload.

So the vocabulary is **closed** — 12 names, `startSpan` accepts nothing else:
`http.request` `generation.create` `generation.execute` `orchestration.execute`
`temporal.workflow` `temporal.activity` `provider.submit` `provider.poll`
`media.ingest` `outbox.dispatch` `security.event` `policy.evaluate`.

Attributes run through **13-E's** `sanitizeTelemetry`, not a second
allow-list. A prompt, a signed URL or a raw provider response cannot enter a
span any more than a log line. Four sinks with four ideas of "safe" was the
failure 13-E prevented; a span path with its own filter would reintroduce it.

### Failure semantics

Tracing is observational. Nothing throws, a broken span sink is swallowed,
and `withSpan` re-throws the caller's error unchanged so error handling is
untouched. A tracing failure must never fail a generation, restart a
workflow, retry a provider, mutate credits or bypass a security control.

### Trace in the response

**Not returned to the client, and no debugging endpoint was invented.** The
roadmap asks for neither. A trace id in a response is a small internal-topology
disclosure with no user-facing benefit today; when 13-D's status page or an
admin surface needs one, that is the moment to decide it deliberately.

### Residual

- **No exporter.** Sentry and OTLP are 13-A's account-dependent half. The
  `TelemetrySink` and `SpanSink` interfaces are the attach points; nothing is
  registered, and an exporter with no service behind it is the
  built-but-unwired defect this repository has closed four times.
- **Spans are emitted at a few representative points**, not yet at every hop
  in the closed vocabulary. The standard, the guard and the propagation are
  the deliverable; blanket instrumentation belongs with the exporter that
  would consume it.
- **`generation.create` does not persist trace_id on the generations row.**
  It travels on the workflow, the command, the outbox and the security event —
  which is the API → worker → provider chain ¶1711 names. Adding a column
  would be a migration this batch deliberately did not make.

---

## Sensitive Data Guard — telemetry allow-list (Phase 13-E)

```
TELEMETRY ALLOW-LIST         ENFORCED — 47 fields, each justified
UNKNOWN FIELDS               DROP
REDACTION BOUNDARY           ONE — every sink must call it
STRUCTURED LOGGER            25 modules migrated
RAW ERROR LOGGING            BLOCKED
CI TELEMETRY SCAN            CLEAN on production sources
EXTERNAL TELEMETRY SINK      NONE
SENTRY / OTEL / DATADOG      NOT CONFIGURED
```

### The binding rule

¶1753: *"Telemetry = İkinci Veri Kopyası: Daha fazla observability daha fazla
sensitive veri kopyası demektir. … Yaklaşım deny-list değil ALLOW-LIST
olmalıdır."* ¶1722 names the forbidden data; ¶1723 is the acceptance test —
forbidden fields provably absent from Sentry/OTel/CloudWatch/Better Stack,
with `trace_id`, `generation_id` and `provider_attempt_id` preserved.

**This landed before any sink exists, and that ordering is the whole point.**
¶1723 can only be *tested* if the guard predates the sinks, and telemetry
already sent to a third party cannot be recalled.

### Allow-list, not deny-list

A deny-list has to predict every field anyone will ever add. It fails the
first time someone logs a helpfully-named object, and it fails silently. An
allow-list fails the other way: a useful field goes missing until someone adds
it, which is a code review rather than an incident.

The list was **built from what the code actually logs** — the keys passed to
the 24 existing `log({...})` helpers were extracted (37 distinct names, zero
object spreads) and classified one at a time. Nothing speculative, and every
entry carries a written justification that a test requires.

| Category | Fields |
| --- | --- |
| correlation (¶1753) | `traceId` `correlationId` `generationId` `providerAttemptId` `attemptId` `workflowId` `eventId` `workspaceId` |
| what happened | `op` `result` `status` `stage` `action` `decision` `classification` `eventType` `workflow` `kind` `subject` `from` `to` … |
| why | `reason` `reasonCode` `errorCode` `error` `errorClass` `severity` `retryable` |
| where | `subsystem` `routeId` `routeClass` `queue` `region` `provider` `modelId` `targetId` `policyVersion` |
| numbers | `durationMs` `count` `attempts` `claimed` `rejected` `riskScore` `sizeBytes` … |

**Forbidden**, by name AND by value shape: prompt text, generated/reference
media, raw bytes, signed and private media URLs, Authorization headers,
cookies, Clerk tokens, Supabase service key, Redis URLs, R2/AWS credentials,
provider API keys, Temporal API key, Stripe secrets, card data, raw provider
responses, request bodies, headers, unrestricted metadata, environment dumps,
stacks and cause chains, email, full IP, user agent, filenames.

**Reduced-only**: a client IP may travel *only* as the sha256 `subjectHash`
bucket 11-D and 12-C already compute — never reversibly, never a raw
`X-Forwarded-For`. Filenames reduce to an extension or MIME class. User agent
and email are not carried in any form.

### The tenant field, stated plainly

¶1753 approves `workspace_id`. Workspaces do not exist yet, so
`resolveEffectiveTenant` sets the tenant to the Clerk principal id — **logging
`workspaceId` today therefore logs a Clerk user id under a different name**.
It is allowed because it is the identifier the roadmap approves and it is a
pseudonymous account handle rather than PII, and because the field name stays
correct once Phase 12-B lands real workspaces, at which point the value
diverges with no call site changing. A field literally named `clerkUserId` is
**dropped**, so the acting principal cannot be logged outside a tenant scope.

### One boundary, and no way round it

`sanitizeTelemetry()` runs before anything is written. Sentry, OTel,
CloudWatch and Better Stack will each register a sink and receive an
**already-sanitized envelope** — they never see the caller's original fields,
so ¶1723 is enforced once rather than four times. There is exactly one call to
the sanitizer in the logger, no `raw` variant and no bypass flag; a test
asserts all three.

Order inside the sanitizer matters and is fixed: secret shape → free-text
length → prose → **truncate** → pattern. A secret-looking value is dropped
WHOLE, never shortened — half a token is still a token's worth, and a
truncated presigned URL still names the bucket and the object.

### Errors never travel as objects

`projectError()` yields at most `errorClass`, `errorCode` and `retryable`.
`error.message` is deliberately absent — a message is authored by whoever
threw, which for a provider is a third party, and no length limit makes
arbitrary third-party text safe. Stacks and cause chains are never
serialized.

### What the live proof caught

Running a realistic error through the real logger showed `errorCode` being
silently DROPPED: every `OrchestrationError` code in this codebase is
SCREAMING_SNAKE (`OUTPUT_DOWNLOAD_FAILED`) and every `error` field carries a
PascalCase `caught.name`, both of which the lowercase code pattern rejected.
That would have blinded error observability across 33 call sites with every
test still green. Both fields now use the `name` shape — same bounds, same
secret and prose checks.

### Migration and the CI scan

25 module helpers now delegate to the guarded logger; their call sites are
unchanged. The two `generate-video` routes that logged a raw `error` object
are fixed — a dev stub over an in-memory Map, so nothing secret was in scope,
but Sentry's console integration captures `console.error` by default and those
would have been the first unredacted stacks shipped to a third party.

`npm run telemetry:scan` inspects log CALL SITES — a different job from
`secrets:scan`, which looks for committed VALUES. It extracts each call's
argument text depth-aware and flags raw errors, `process.env`, requests,
bodies, headers, prompts, provider responses, spreads and stacks. Seven
synthetic positive controls plus one negative control live in
`src/test/fixtures/telemetry/`.

Two flaws in its first version are worth recording, because they are how a
scanner becomes useless: it blanked block comments without preserving
newlines, corrupting every line number after a doc comment; and it matched a
bare `e` as an error variable inside a six-line window. Together those
produced 45 findings, 44 of them false. A scanner that cries wolf is worse
than none.

Process-lifecycle console output (started / stopped / refusing to start /
fatal) is exempt in five **named files** — never a directory — and only from
the raw-error rule. Those lines must survive a broken logger: "the logger
threw" is exactly when you need to know why a process died.

### Known and pinned, not fixed here

Two **client** components log the user's raw prompt to the browser console:
`ImageGenerationForm.tsx` and `MarketingStudioProductWorkspace.tsx`. They are
genuine ¶1722 findings and they are NOT fixed in this batch:

- `MarketingStudioProductWorkspace` is rendered by `/marketing-studio/product`,
  a **LOCKED route**. A lock is not waived by the change being small.
- Client telemetry is a separate contract that Phase 13 has not written. A
  browser console write copies nothing to a third party.

Both are pinned by test, so a **third cannot appear unnoticed**, and the day
the lock lifts the test names exactly what to fix.

### Failure semantics

Telemetry failure is not business authority: nothing throws, nothing is
awaited, a broken sink is swallowed. A logging failure must never fail a
generation, retry a provider, mutate billing, drop a durable security event or
crash a worker.

The guard fails the **opposite** way, deliberately: an unsafe field is
DROPPED, never emitted. Losing observability is recoverable; a prompt in a
third-party system is not.

### Residual risk

- **No sink exists, and none is written.** An exporter with no service behind
  it is the built-but-unwired defect this repository has closed four times.
  13-A/13-B/13-C register sinks against the interface that now exists.
- **A call-site scan cannot prove a runtime value is safe** — the tool says so
  in its own output. It complements the sanitizer; it does not replace it.
- **Client telemetry has no contract.** Nothing browser-side may carry
  secret-bearing telemetry, and the two pinned prompt logs are the open item.
- **`correlationId` and `traceId` are two names for one concept**, and no
  trace is minted at the HTTP edge yet. Converging them and minting at the
  edge is 13-A's core deliverable.

---

## Secret manager, environment separation, least privilege (Phase 12-D)

```
ENVIRONMENT SEPARATION       RUNTIME-ENFORCED — 3 worker entrypoints, fail-closed
SERVER SECRET BOUNDARY       ENFORCED — server-only + structural tests
PROVIDER SECRET ISOLATION    ENFORCED — one name per provider, generic forbidden
LEAST PRIVILEGE CONTRACT     6 runtime roles, no wildcards
SECRET MANAGER RUNTIME       CODE_READY (interface + env backend)
LIVE SECRET MANAGER          DEFERRED_EXTERNAL_INFRA
KMS RUNTIME                  DEFERRED_TO_PHASE_25
ROTATION RUNBOOK             WRITTEN — no credential rotated
LEAK RUNBOOK                 WRITTEN
SECRET SCAN                  CLEAN on tracked files
CONFIG HEALTH REPORT         presence-only, no HTTP endpoint
PAID INFRA CREATED           NO
```

### What 12-D owns, and what Phase 25 does

The two overlap heavily and the roadmap resolves it: ¶2688 states Phase 25's
connection is "Phase 12 Secret Management + Phase 15 DR + IaC foundation" —
Phase 25 BUILDS ON this. So:

| | 12-D (here) | Phase 25 |
| --- | --- | --- |
| Environment separation | contract + validation | live per-env key namespaces |
| Secret backend | interface + env provider | live Secrets Manager (¶2692) |
| KMS | ownership boundary only | key hierarchy, aliases, policies (¶2690–91) |
| Rotation | written procedure | managed schedules + reload verification (¶2680) |
| Leak response | written runbook | automated revoke→reload→verify (¶2694) |
| Monitoring | — | CloudTrail → `security.events` (¶2683) |

¶1686 is why the contract half lands now rather than with the infrastructure:
"Secrets Manager/KMS + dev/staging/prod ayrımı, ileri bir Phase değil PROVIDER
AĞI BÜYÜMEDEN ÖNCE (Phase 8 ön koşulu) tamamlanır." ¶1118 gives the reason —
per-provider isolation "provider sayısı 2–3 iken kolay, 10 iken zahmetlidir".

### The inventory is code, not a document

`src/lib/config/secret-registry.ts` holds 63 variables, each with a class, a
production requirement, an owning group and a rotation procedure. It contains
**no values and reads nothing** — safe to import from a test or paste into a
report (¶2087: "yalnız boolean/presence kontrolü").

`.env.example` is generated from it, and tests assert both directions: every
`process.env` read in shipped code is registered, and every registered name is
documented. A new variable that skips the registry fails the build rather than
becoming an undocumented production dependency.

| Class | Meaning |
| --- | --- |
| `PUBLIC` | shipped to the browser on purpose |
| `IDENTIFIER_NON_SECRET` | server-side but not a credential |
| `SERVER_SECRET` | Cinefield's own data or identity plane |
| `INFRA_SECRET` | infrastructure we pay for and store state in |
| `PROVIDER_SECRET` | spend at a third party — a leak costs money silently |
| `LOCAL_ONLY` | must never exist in production |

### The accident this actually prevents

Not a typo. A production deployment that inherits a development resource and
**works**: a staging worker writing into production Redis, a preview
environment holding a real provider key and spending real money, a production
build pointed at localhost that degrades and reads as a dependency outage.
Each passes a health check, so the checks are explicit.

The environment is **declared**, not inferred. `CINEFIELD_ENV` wins over
`VERCEL_ENV` because a Vercel "preview" may be a real staging deployment with
real staging resources, and treating it as development would exempt it from
every check. An unrecognised value resolves DOWN to `development` — the
environment with the fewest permissions — so a typo can never grant anything.

`validateConfiguration()` refuses, in production:

- a missing `PRODUCTION_REQUIRED` variable
- a `LOCAL_ONLY` variable being present (one of them bypasses Temporal)
- localhost / 127.0.0.1 / host.docker.internal in Redis, Temporal, Supabase or R2
- `http://` or `redis://` where TLS is required (6R.25 / ¶1225)
- a `pk_test_` / `sk_test_` Clerk or Stripe credential
- a Temporal namespace naming a different environment than the one running

and in **every** environment:

- a forbidden generic credential name
- `REDIS_URL` equal to `BULLMQ_REDIS_URL` — red note ¶244 and 6R.25 keep Redis
  A (application state) and Redis B (BullMQ only) on separate credentials;
  sharing one means a queue flush wipes rate-limit counters, connection leases
  and idempotency records, which presents as an unrelated outage

Development is deliberately unconstrained. localhost and a test Clerk key are
what development IS, and a validator developers have to disable protects
nothing.

### Runtime enforcement — the defect this originally shipped with

The first version of 12-D shipped `assertValidConfiguration()` complete,
tested, and **called by nothing**. Environment separation was enforced by no
code that runs: a production worker pointed at a development Redis would have
been caught by no check. The Phase 12 final gap audit found it as D12-D2 —
the fourth time this repository produced a complete, tested, unreachable
control (after D-11-1, D-12-1, and the 12-C logger near-miss).

It is now wired. `src/lib/config/startup-validation.ts` is called as the
**first statement** of `main()` in all three long-lived workers:

| Worker | Guard runs before |
| --- | --- |
| `temporal-worker` | `readConfig`, `NativeConnection.connect`, `Worker.create` |
| `provider-worker` | `readConfig`, `new SQSClient`, `ReceiveMessageCommand` |
| `realtime-dispatcher` | `isSupabaseAdminConfigured`, `getSupabaseAdminClient`, `dispatchRealtimeOnce` |

**Not at module load.** A throw during import in a Next.js server component
takes down the routes that would tell an operator what is wrong, and fires
during a build as readily as a request. The guard belongs at the top of a
worker's `main()`, where the process can refuse cleanly.

**Fail-closed, with no bypass.** An invalid production configuration exits
non-zero before the worker polls, connects, claims or submits. There is no
flag, no environment variable and no "warn and continue" — a guard with an
escape hatch is one that gets used during the incident it exists for, and a
test asserts none exists. It never downgrades production to development.

Development and staging pass through untouched: the production rules only
apply in production, and a guard developers must disable locally protects
nothing.

**Proven by spawning, not only by reading.** Structural tests assert the call
is written and ordered first; runtime tests actually spawn each worker with an
invalid production configuration and assert the exit code, the sanitized
refusal, the reason codes, and the ABSENCE of every post-startup log line —
no poll, no claim, no publish, no connection. A canary planted inside a
credential-shaped value appears nowhere in any worker's output, not even as a
fragment.

A real refusal looks like this, and this is the whole of it:

```
[cinefield:startup] refusing to start {"runtime":"temporal-worker",
  "environment":"production","findingCount":16,
  "reasons":["development_instance_in_production","insecure_scheme_in_production",
             "localhost_in_production","missing_required"]}
```

Counts and codes. No variable values, no lengths, no hashes, no prefixes.

### The configuration health report

`configurationHealth()` reports environment, valid/invalid, a
missing-required COUNT, distinct reason codes, and which subsystems are
deferred on purpose (so "missing" is never read as "broken" — `live-secret-manager`
and `live-kms` are always listed). It carries no per-variable presence map;
`configurationReport()` has that for tooling inside the process.

**It is deliberately not behind an HTTP route,** and a test asserts it stays
that way. The roadmap asks for no such endpoint, and an unauthenticated health
endpoint enumerating which secrets are missing tells an attacker exactly which
subsystem is half-configured. It has no automatic caller — which is correct
for a pull interface, and is a different thing from the enforcement mechanism
that had none.

### Nothing leaks through an error

`ConfigFinding` has three fields — variable NAME, reason CODE, environment.
There is no field a value could travel in, which is the enforcement rather
than a convention. A test plants a canary value in four variables and asserts
it appears in no finding, no report, and no thrown error or stack — not even a
fragment, because a prefix or a length is still information.

### The server-only boundary

`getServerSecret(name)` is `server-only` and refuses an unregistered name.
That refusal is the load-bearing part: a new credential cannot be introduced
by writing a call, because the registry entry — class, requirement, rotation
procedure, `.env.example` line — has to exist first. The gate sits where
someone is motivated to skip it.

It also refuses a NON-sensitive name, so it does not become a general
`process.env` wrapper: a region or bucket name is read directly, keeping "was
this a secret?" answerable by reading the call site.

Tests scan every `"use client"` module and fail if one imports the boundary or
reads anything but `NEXT_PUBLIC_*` / `NODE_ENV`; and every `NEXT_PUBLIC_`
variable the code reads must be registered `PUBLIC`. An unregistered name is
treated as sensitive — failing safe costs a refused read, failing the other
way copies a secret somewhere.

**This is a boundary, not a refactor.** The nine existing `*-config.ts`
modules already validate shape and report presence as a boolean without ever
returning a value. Rewriting them would be a large diff across the provider,
storage, queue and workflow paths for an aesthetic gain and a real risk of
breaking a working credential path.

### Provider isolation

¶1686: "Her provider ayrı secret ve ayrı scope kullanır; tek compromised CI
logunun blast radius'u sınırlanır." Twelve providers, twelve distinct variable
names, ten of them deferred contract-only for Phase 8.

A generic `PROVIDER_API_KEY` is **forbidden**: absent from the registry,
rejected by `validateConfiguration()` in every environment, and asserted
missing from source and `.env.example` by test. It is not a mistake anyone
makes deliberately — it is what happens when a fourth provider is added in a
hurry and an existing variable looks reusable.

### Least privilege — six runtimes, no wildcards

Full matrix in [least-privilege.md](./security/least-privilege.md). Terraform
in `infra/modules/iam/`; **nothing is applied**.

| Runtime | AWS grant |
| --- | --- |
| Task execution | ECR + logs + only the named secret ARNs |
| Provider worker | named SQS queues; consume and produce granted separately |
| Temporal worker | named queues; this cluster's MSK topic prefix |
| **Realtime dispatcher** | **none** — it uses PostgreSQL and Redis, neither of which is an AWS service |
| **DR backup** | S3 put + read-back on one bucket. **No DeleteObject**, no queues |
| **Media worker** | one write path. No ListBucket, no SQS |

The dispatcher having an empty role is the point of one-role-per-boundary: the
day it needs an action, granting it is a reviewed one-line change instead of
something it already had by sharing.

The media worker enforces red notes ¶327 and ¶1458 — "provider/DB secret YOK …
minimum IAM". The IAM half is one write path; the **secret** half is the
injection matrix, and it is the half that matters: a parser exploit in a
process holding a Supabase service key is a database compromise, while the
same exploit in a process holding nothing is a wasted container. 6R.22 (¶1219)
adds that the media worker has no `SendMessage` to the generation command
queue — there is no SQS statement in that role at all, so it holds by
construction rather than by a deny rule someone could reorder.

No long-lived AWS access key is expected anywhere: production uses task roles,
and a stored key would be a finding rather than a credential to schedule.

### Rotation and leak response

[secret-rotation.md](./runbooks/secret-rotation.md) — six steps for every
credential: create → deploy → validate → revoke → **verify dead** → record.
Step 5 is the one that gets skipped and the one that matters; ¶2684 requires
it explicitly.

Zero-downtime overlap is claimed **only where the issuer supports it**.
Where support was not confirmed against the current dashboard the entry is
`CUT_OVER`, because planning for an overlap that turns out not to exist fails
during an incident.

[secret-leak.md](./runbooks/secret-leak.md) — CONTAIN → ROTATE → REVOKE →
AUDIT → REDEPLOY → VERIFY (¶2694), with a procedure per leak type. Two things
it insists on: check provider usage BEFORE rotating, because after rotation
you lose attribution; and removing a commit does not undo the exposure —
rotation is what fixes it.

**No credential was rotated.** Secret operations are on the two-person list
(¶2284) and are registered in the 12-E policy gate as `secret.rotate`,
currently denying.

### Secret scanning

`npm run secrets:scan` — shape matching over tracked files, clean today.
It reports the rule and the location, never the matched text, because printing
a match copies the secret into CI output.

Two honest limits, both stated by the tool itself: it cannot detect a secret
with no recognisable shape, and **a green scan is not proof of absence**. A
scanner that oversells itself is worse than none, because a green result is
what people trust instead of reading the diff. GitHub Secret Scanning
(Phase 17, ¶1781/¶1806) covers the provider-verified half.

Credential-shaped strings in existing tests were handled by narrowing the rule
to skip RFC 2606 / RFC 6761 reserved hosts (`example.com`, `.test`,
`.invalid`) rather than by exempting the files. Skipping a path hides a real
secret committed there forever; skipping an unroutable host loses nothing,
because a leaked credential worth having points at a host that exists.

The scanner's own **positive control** — a credential aimed at a
routable-looking host, which must be flagged — lives in
`src/test/fixtures/secret-scan/`, the single narrowly-scoped exclusion. It
began as a string literal inside the 12-D test file, which was defect D12-D1:
the assertion passed while that file was untracked and started failing the
moment it was committed, because the scanner correctly flagged its own
control. Test-only, never importable by runtime code, and a test proves the
same content OUTSIDE that directory still fails — so a green tree cannot be
achieved by widening the exemption.

### Local development is unchanged

`.env.local` stays the local mechanism: gitignored, untracked, never printed,
never copied into docs — all four asserted by test. Development requires no
production-only secret, and `validateConfiguration()` returns `ok` with every
production credential absent.

### Production contract (target, not claimed live)

- **Vercel web** — production-scoped environment variables, then the approved
  secret mechanism.
- **ECS workers** — task role plus secret ARNs resolved by the execution role,
  scoped to exactly the secrets each task definition references.
- **No production plaintext secret file**, anywhere.

### Residual risk

- **`LIVE_SECRET_MANAGER: DEFERRED_EXTERNAL_INFRA.** No AWS Secrets Manager
  secret exists, no KMS key was created, no IAM was applied. Everything above
  is code, contract and documentation.
- **No `AwsSecretsManagerProvider` class exists**, deliberately. Writing an
  implementation nobody can run against a real backend would be the
  built-but-unwired defect this project has closed three times. Phase 25 adds
  one class and one line in `resolveSecretProvider`; no consumer changes.
- **The nine existing config modules still read `process.env` directly.** They
  already never return a value, so the security property holds; adopting the
  boundary is mechanical work for Phase 25 to do alongside the backend.
- **The Vercel web tier has no startup guard.** The three long-lived workers
  enforce configuration at startup; a serverless function has no startup to
  hook, and throwing at module load would take down the routes that report the
  problem. `configurationHealth()` is callable there, but nothing calls it —
  wiring an operator surface for it belongs with Phase 13's observability
  work, not here.
- **Rotation is untested against real issuers.** ¶1646 says "rotation testli";
  the procedure is written and the dual-key claims are marked as claims, but
  no credential has been rotated. That requires production infrastructure and
  the two-person approval the roadmap already demands.
- **The overlap table is partly conservative.** Several `CUT_OVER` entries may
  in fact support dual keys; confirming one is a five-minute registry change.

---

## OPA/Rego policy gate + critical action guardrails (Phase 12-E)

```
POLICY GATE                  BUILT AND ENFORCING
CRITICAL ACTIONS GATED       6 real actions, 15 registered
DEFAULT DENY                 YES — including malformed input and engine failure
AI/MCP WRITE AUTHORITY       DENY (allowlist empty, asserted by test)
HUMAN APPROVAL               REQUESTED, never performed — Phase 16 owns it
TWO-PERSON APPROVAL          PRESERVED — policy composes, never substitutes
PRIVACY ACTIONS              REGISTERED AND DENIED — Phase 23 owns the workflows
OPA RUNTIME EVALUATION       DEFERRED TO PHASE 19 (roadmap ¶2272) — see below
PG PROOFS                    S12E-1 .. S12E-10 PASS
LIVE VALIDATION              11 / 11 PASS (synthetic inputs, zero cost)
```

### The acceptance test

Roadmap ¶1648 asks for "OPA/Rego policy gate + privacy/data-lifecycle güvenlik
bağlantıları". ¶1649 is the criterion: **"Kritik action policy sonucu olmadan
çalışmıyor"** — a critical action does not run without a policy result.

Six real actions now evaluate policy before they mutate anything, and each
gated function's next statement after its existing authorization check is
`await requirePolicy(...)`, which returns an ALLOW or throws:

| Action | Owner | Gated at |
| --- | --- | --- |
| `media.quarantine.request` | 9-E | `quarantine-release.ts` |
| `media.quarantine.release` | 9-E | `quarantine-release.ts` |
| `media.quarantine.reject` | 9-E | `quarantine-release.ts` |
| `routing.control.set` | 7-E | `admin-route-service.ts` |
| `routing.control.clear` | 7-E | `admin-route-service.ts` |
| `security.temporary_block.apply` | 12-C | `security-event-logger.ts` |

A structural test locates each function, finds the gate, and fails if any
mutation (`.rpc(`, `setRoutingControl`, `redis.set`) appears before it. Another
proves each SQL function has exactly one caller, so no second ad-hoc path
exists.

**Low-risk routes are deliberately NOT gated.** Generation creation, provider
submission, model listing and media upload keep the PRE-12 rate limiter and
their own authorization. Pulling ordinary operations behind a fail-closed
boundary would trade a real availability risk for no security gain, and a Rego
test fails if a non-critical action is added to the registry.

### Rego is the specification; the runtime implements it

`policies/cinefield/policy.rego` is normative.
`src/lib/policy/policy-engine.ts` implements exactly its rules, in exactly its
order, over exactly its data document — `policies/data/actions.json` has ONE
definition, loaded by OPA as `data.cinefield.actions` and imported directly by
the engine.

The two are bound by `policies/conformance/cases.json`: `policy_test.rego`
iterates it under `opa test`, and the TypeScript suite iterates the same file
under `npm test`. A rule that drifts fails one of the two runs. Adding a case
extends both suites at once.

**OPA is not a runtime dependency and policy availability never depends on a
network call, a sidecar, or a paid service.** Two reasons, in order: the
roadmap places full OPA among the scale-triggered layers (¶416, ¶3734, ¶3766)
and gives Phase 19 the explicit task of standing up the service (¶2272); and a
policy sidecar would make every critical action depend on a second process
being alive, which for a fail-closed gate means an outage there stops
quarantine handling entirely.

`PolicyDecision.engine` records `"embedded"` on every decision so that when
Phase 19 swaps in a compiled bundle the change is visible in the decision log
rather than inferred from deploy dates. Install and build commands are in
`policies/README.md` and `npm run policy:test` / `policy:build`.

### Default deny, at every way in

| Condition | Result |
| --- | --- |
| unknown action | `DENY unknown_action` |
| registered but unbuilt action | `DENY not_implemented` |
| malformed or missing input | `DENY malformed_input` |
| missing risk flag | `DENY malformed_input` — **not** defaulted to false |
| unknown actor or role | `DENY unknown_subject` |
| unknown environment | `DENY unsupported_environment` |
| non-server origin | `DENY untrusted_origin` |
| evaluator threw | `DENY policy_evaluation_failed` |
| unrecognised decision from any engine | `DENY malformed_decision` |
| registry entry not fully specified | **process fails at load** |

A missing risk flag being refused rather than defaulted is the load-bearing
one: defaulting would treat a caller who forgot to resolve block state as
unblocked, which is the exact fail-open the gate exists to prevent.

Note the deliberate asymmetry with Phase 12-C. The security logger fails OPEN
because it records something that already happened, so its failure must not
change the outcome. This decides whether something happens at all, so its
failure must. The one exception is stated where it lives: an automatic
temporary block fails closed by **not enforcing**, because refusing to block
leaves a subject unblocked while refusing to release leaves media unreleased —
for a discretionary automatic action against a person, not acting is the
conservative direction.

### Ordering is part of the contract

Several conformance cases exist only to pin precedence. Two are load-bearing:

- `untrusted_origin` is checked **before** the AI rule, so a browser-driven
  agent is refused as a browser.
- the AI rule is checked **before** the role check, so an agent operating
  under a borrowed admin role cannot satisfy its way past the guardrail.

### AI / MCP write authority is OFF

Roadmap ¶1856: "MCP bağlantıları varsayılan olarak READ-ONLY başlar. Write
işlemi yalnız AI suggestion → policy (OPA) → human approval → protected
workflow sırasıyla mümkündür. Bu sıra hiçbir incident aciliyetiyle atlanmaz."
¶1854 adds that a tool-level allowlist is mandatory and no general authority is
ever granted.

`aiWriteAllowlist` started **empty**, so every agent write denied with
`ai_write_authority_off` — a Rego test fails if an entry appears without a
matching TypeScript conformance case, which forces the change to be
deliberate. Even an allowlisted tool only reaches `REQUIRE_APPROVAL`: policy
is never the last step for an agent.

**Phase 14-B narrowed the allowlist from empty to exactly one entry:
`code.pr.create`.** It is the single narrow capability 14-A's canonical chain
needs — an AI Fix Agent preparing a pull request, never merging or deploying
one — and it still requires human approval evidence like every other
allowlisted action; nothing about the allowlist having a first member weakens
the "policy is never the last step for an agent" rule above. Every action
that is not `code.pr.create` is denied by `ai_write_authority_off` exactly as
before, pinned by `phase-12e-policy-gate.e2e.test.ts` test 10's
`assert.deepEqual(REGISTRY.aiWriteAllowlist, ["code.pr.create"])`.

`requireAiWritePolicy` is a separate entry point rather than a flag, so "an
agent is asking" is a call site a reviewer can grep for and no human path can
acquire agent semantics by passing the wrong argument. **It now has its first
real caller** — `src/lib/deployment/ai-pr-authority.ts`'s
`evaluateAiPrProposal`, which composes this gate with a change-risk taxonomy
and a required-CI-check registry (Phase 14-B) — proving the guardrail landed
before the capability, in that order, rather than the reverse. No GitHub
integration exists yet: `evaluateAiPrProposal` decides whether a PR *may* be
opened, and returns that decision as data. Nothing calls a GitHub API,
creates a branch, or opens a PR — 14-A's own external half.

A structural guarantee sits above the allowlist entry itself: 14-B's
change-risk classifier treats `src/lib/policy/` and `policies/` (including
`policies/data/actions.json`, the allowlist file itself) as
`FORBIDDEN_AUTOMATION` — a change in that class never reaches
`requireAiWritePolicy` at all, so an AI Fix Agent cannot propose editing its
own allowlist through the very mechanism the allowlist gates.

Agent-initiated decisions are recorded with an `ai_`-prefixed reason code
(¶1852 — AI provenance alongside the policy version).

### The gate grants nothing

An ALLOW means policy raises no objection. It is an ADDITIONAL condition,
never a replacement for one, and four tests exist because a policy engine that
quietly became an authorization source would be a worse posture than none:

- **Two-person approval is preserved.** `media.quarantine.release` returns
  `ALLOW allowed_two_person_enforced_downstream` — a distinct reason code so a
  decision log cannot be misread as a satisfied approval. The threshold is
  still a `PRIMARY KEY (asset_id, approver_clerk_user_id)` inside the SQL
  transaction, which is the only place it can be enforced correctly.
- **Moderation is untouched.** The word does not appear in the policy layer's
  code. An admin may release a cleared asset, never declare one cleared.
- **Credits and billing are unreachable.** Phase 10 is not touched.
- **The generation lifecycle is unreachable.** The engine's entire import list
  is the registry and its own contract.

### Bounded in, bounded out

The input is an allowlist, not a context bag: no `metadata`, no `payload`, no
`request`, no index signature — so a caller cannot pass the raw body "in case
the policy needs it". Tests fail on any prompt-, secret- or URL-shaped field.
That matters because a policy input travels into a decision log, and a decision
log is read during incidents.

Output is five decisions, a short reason code matching
`^[a-z][a-z0-9_]{1,64}$`, the policy version, and the engine. No free text is
ever used as authority.

Everything the gate reads is server-derived: `originClass` is a literal
`"server"`, the actor comes from an already-verified id, block state is fetched
from Redis/PostgreSQL rather than accepted, and absent approval evidence means
not approved.

### Decision evidence — no second audit platform

The decision log is `security_events`, extended with two kinds
(`policy_decision_allowed`, `policy_decision_denied`), one source
(`policy_gate`) and one column (`policy_version`). Everything 12-C built
applies unchanged: append-only trigger, bounded columns, short-code reasons,
storm control, service_role-only grants.

**Both outcomes are recorded.** A log holding only refusals cannot answer "who
released that asset, under which policy version" — the question an incident
actually asks.

The migration is strictly additive, and S12E-7 re-asserts the entire
pre-12-E vocabulary because a widened CHECK written as DROP + ADD is exactly
where a value gets lost.

### A wrong assumption the proofs caught

The first draft appended `p_policy_version` with a DEFAULT and relied on
`CREATE OR REPLACE` to replace `record_security_event` in place. PostgreSQL
identifies a function by its **full** argument type list, so it created an
OVERLOAD and the catalog held two definitions — which would have made every
existing 8-argument call ambiguous the first time a security signal was
recorded in production. S12E-1 caught it before the migration was ever applied;
the migration now drops the old signature explicitly. This is the identical
failure `20260824000000` records for `emit_outbox_event`, which is why the
assertion existed in advance.

### Privacy / data-lifecycle seam

Five actions are registered, all `DENY not_implemented`, each naming
`phase-23` as owner and each marked two-person + human-approval so a future
implementation inherits a reviewed rule rather than inventing one:
`data.export`, `data.delete`, `retention.override`, `legal_hold.set`,
`legal_hold.clear`. An unregistered privacy action denies as
`unknown_action`. **No Phase 23 workflow is implemented.**

### Residual risk

- **`REQUIRE_APPROVAL` is reachable as of Phase 14-B, but only through
  `code.pr.create`.** `ai-pr-authority.ts`'s `evaluateAiPrProposal` calls
  `requireAiWritePolicy` for every change that is not `FORBIDDEN_AUTOMATION`,
  and since nothing in this repository yet produces real
  `approvalEvidence.humanApproved = true` (that evidence-producing workflow is
  Phase 16's), every real call resolves to `REQUIRE_APPROVAL` today — the
  first genuinely live producer of that decision. Every OTHER action that
  would trigger it (`data.export`, `admin.review.resolve`, `account.suspend`,
  and the rest of Phase 16/23's seams) is still registered as
  not-implemented and denies earlier, which remains correct — deny outranks
  hold. The `ALLOW` branch of `code.pr.create` remains unreachable in
  production for the same reason it was designed to be: nothing may assert
  `humanApproved: true` without a real approval workflow, and none exists
  yet.
- **`risk.adminReviewRequired` and `risk.challengeRequired` are hard-coded
  false in the gate.** Phase 12-C records those as RECOMMENDATIONS on evidence
  rows; no durable per-subject flag exists, and deriving one from a
  recommendation would be inventing state. `temporarilyBlocked` IS wired to a
  real Redis read. The rules are implemented and tested through
  `evaluatePolicy` directly; Phase 16 owns the review state that makes them
  reachable through the gate.
- **OPA does not evaluate at runtime.** The Rego is normative and
  conformance-bound, but the shipped evaluator is the embedded one. Phase 19
  owns the swap, and the engine name in every decision is what will make it
  visible.
- **No admin UI, no operator surface.** `admin_review` requests and denied
  decisions accumulate as queryable rows; nothing displays or actions them
  until Phase 16.
- **The registry is a file, not a governed artifact.** Changing a rule is a
  code change and a version bump, reviewed like any other. Phase 19 owns
  policy lifecycle and governance.

---

## Security Event Logger + Risk Engine (Phase 12-C)

```
SECURITY EVENT LOGGER        BUILT AND WIRED
PRODUCERS CONNECTED          5 / 6 kinds
AUTH_SECURITY_SIGNAL         PARTIAL_UNTIL_CLERK_PRODUCTION
CHALLENGE_ENFORCEMENT        BLOCKED_UNTIL_12A_EDGE
PG PROOFS                    S12C-1 .. S12C-10 PASS
LIVE VALIDATION              10 / 10 PASS (synthetic subject, zero cost)
PHASE 16 ADMIN ACTIONS       NOT IMPLEMENTED — review is REQUESTED, not performed
```

### What this is, and what it deliberately is not

The roadmap (¶1642, ¶1643, ¶1670) asks for a chain: a signal becomes evidence,
evidence becomes a score, a score becomes a controlled action. All three exist
now. What does **not** exist is a classifier: the score is a small sum a reader
can compute by hand, because an opaque number cannot be justified to the person
it was applied to, and a model trained on user behaviour is profiling nobody
agreed to.

The engine reads exactly four things — the kind's fixed severity, how many
windows this subject produced the signal in, whether the subject is
authenticated, and whether the subject actually CAUSED the event. It reads
nothing about prompt content and nothing about the person.

### Two tables, on purpose

| | |
| --- | --- |
| `security_events.kind` | the detailed operator taxonomy, bounded by CHECK |
| `security.warning` | the ONE user-facing event type |

The domain event contract admits exactly two dotted segments, so
`security.rate_limit.denied` is not expressible — and widening a domain
contract to fit a logging vocabulary is the tail wagging the dog, which is
the drift PRE-11 already repaired once. A user learns that something was
refused. An operator learns what.

`media_safety_audit` is **not** reused. It is domain evidence for one decision;
widening it into a global security log would put rate-limit noise beside a
two-person moderation approval and make both harder to reason about.

### Storm control is the schema

An attacker generating ten thousand rejected requests must not turn the
security logger into a database amplifier that finishes the job for them. A
signal is written at most once per `(dedupe_key, window_started_at)`, enforced
by a unique index, and a repeat is an `ON CONFLICT DO NOTHING`.

**What that trades.** The exact count WITHIN a window is not stored. Escalation
does not need "4,812 denials this minute"; it needs "this subject tripped the
limit in twelve of the last fifteen minutes", which is a row count and is
exactly what survives. A mutable `occurrence_count` would have preserved
magnitude at the cost of making the evidence rewritable — and evidence that can
be rewritten is not evidence.

Coalescing is per SUBJECT, never global (S12C-3): one noisy account cannot
suppress everybody else's evidence for the rest of the window. It bounds the
NOTIFICATION rate too (S12C-8) — a user told once per window is informed; told
per request they are being attacked through the notification channel.

The two rare, privileged kinds (`media_release_approved`, `media_rejected`)
widen the key with the resource id so two releases in one second are two audit
rows. Nothing attacker-controllable does: if the generation id widened the key
for SSRF signals, minting generations would mint evidence rows.

### The attribution cap — the rule that stops the wrong person being punished

Every row carries a subject, but a subject is not always an actor. When a
provider returns a result URL pointing at cloud metadata, the gateway refuses
it and the only identity in scope is the owner of the generation, who did
nothing except ask for a video. Scoring that `high` is right; blocking that
account for it would be a bug with a person on the other end.

So `KIND_SUBJECT_IS_ACTOR` is explicit, and a subject who did not cause the
event can never be challenged or temporarily blocked — the strongest available
response is `admin_review`. The score is **not** lowered, so the row still
records both how alarming the signal was and why the response was limited.
Without the cap the arithmetic reaches `temporary_block` after five windows.

### What each action means today

| Action | Status |
| --- | --- |
| `warning` | enforced — travels the Phase 11 outbox path to the browser |
| `challenge` | **recommended only.** Turnstile is 12-A's edge half. Degrades to `warning` and says so; nothing pretends a challenge was served |
| `temporary_block` | enforced — Redis A key with a 900s TTL Redis expires itself. No unblock call, no ban list, no permanent form (S12C-4 proves `permanent_ban` is unrepresentable) |
| `admin_review` | **requested only.** The request IS the row: `recommended_action = 'admin_review'` is queryable the moment Phase 16 exists. Building a queue now would be implementing Phase 16 under another name |

Rate limiting alone can never reach challenge or block, at any volume. That is
asserted, not merely intended.

### Connected — which is the part that usually fails

This project has shipped a complete, tested, unreachable control twice
(D-11-1, D-12-1). A Security Event Logger with no producers would be the worst
instance of it, because an empty security table reads as "no incidents".

Every producer lives in one file, `security-signals.ts`, and a test fails if
any is disconnected:

| Signal | Wired at |
| --- | --- |
| `rate_limit_denied` | the PRE-12 observer seam, installed by `response-headers.ts` |
| `outbound_fetch_blocked` | `output-normalizer.ts`, the SSRF gateway's only caller |
| `realtime_connection_denied` | the 11-D ceiling in the SSE route |
| `realtime_event_unroutable` | the 11-A dispatcher |
| `media_release_approved` / `media_rejected` | the 9-E TypeScript wrappers |

`auth_failure` has **no producer**, and that is declared rather than
accidental. Clerk owns authentication; its failed sign-ins happen at Clerk, not
in this process. Inventing a producer that fires on a missing session would
record "not signed in yet" as an incident several thousand times a day. The
honest state is `AUTH_SECURITY_SIGNAL: PARTIAL_UNTIL_CLERK_PRODUCTION`.

### A warning had to be ROUTABLE, not merely emitted

`emit_outbox_event` resolves the tenant itself and knew two aggregate types.
Emitting `security.warning` against a third would have written
`tenant_id = NULL` — which 11-D refuses to route and 11-A counts as
`realtime_event_unroutable`. The warning would have committed, looked correct
in the outbox, and reached nobody: D-11-1 exactly. The resolver learned the new
aggregate rather than the emitter learning a parameter, so
`emit_outbox_event`'s signature stays byte-identical and there is still exactly
ONE place a tenant can come from.

An untenanted signal emits no warning at all (S12C-9), so anonymous refusals
never become permanent outbox debt.

### Logging failure never reopens a closed door

Every reporter returns `void` and every write is detached. The refusal each one
describes has already been decided and returned by the time it is called. If
Supabase is unreachable the signal is lost — the correct trade, because the
alternative is a security control whose failure mode is admitting the request
it just refused.

### What cannot appear in a row

Bounded columns and short-code reasons throughout. `reason_code` matches
`^[a-z][a-z0-9_]{1,64}$`, so a signed URL, a provider message and a path are
all refused by the database (S12C-5), not merely by convention. The SSRF
reporter's SIGNATURE has no parameter a URL could arrive in — the guarantee is
in the type, not in everyone remembering. Approver identities stay in
`media_safety_audit`; copying one into a second table doubles the places it can
leak from and adds no capability.

The user-facing payload carries `reasonCode` and `severity` and nothing else.
Absent by design: the score, the thresholds, the recurrence count, the limit,
the route, the address hash, the rule that fired. A user who learns they are
eight points below a block has learned how to sit at seven.

### Timekeeping

`clock_timestamp()`, not `now()`. Inside a long transaction `now()` is the
transaction's start time, so three refusals seconds apart would floor to one
window and the recurrence count would stay at 1 while an attack escalated. The
proofs caught exactly that.

### Residual risk

- **`auth_failure` is unobservable** until Clerk production configuration and
  its webhook exist. The category is kept rather than deleted so the gap is
  visible.
- **`challenge` cannot be enforced.** It is recorded as a recommendation and
  degraded to a warning. 12-A's edge half remains `BLOCKED_UNTIL_DOMAIN`.
- **No operator surface exists.** `admin_review` rows accumulate and are
  queryable; nothing displays or actions them until Phase 16.
- **Magnitude within a window is not stored.** Deliberate — see storm control.
- **Retention is not implemented.** The table is strictly append-only, DELETE
  included; Phase 23 will lift that specific ability deliberately. The
  `occurred_at` index exists so retention is a policy decision, not a
  migration.

---

## Application rate limits and private cache defaults (PRE-12 / Phase 12-A, application half)

```
D-12-1 RATE LIMIT GAP        CLOSED
D-12-2 PRIVATE CACHE GAP     CLOSED
ROUTES GUARDED               14 / 14
LIVE REDIS PROOF             PASS (Redis A, isolated synthetic namespace)
PHASE 12-A EDGE HALF         BLOCKED_UNTIL_DOMAIN
PHASE 12-A                   NOT COMPLETE — this is the application half only
```

### What was wrong

`consumeRateLimit` had existed, complete and tested, since Phase 6R.7 with
**zero production callers**. Fourteen API routes had no rate limiting at all,
including `generate` and `orchestration/execute`, which trigger paid provider
work. Until an edge WAF exists the only thing between a signed-in account and
unbounded spend was the Clerk session.

Twelve of fourteen routes also emitted no cache header, relying on a framework
default that is safe only because every route is dynamic — precisely the
assumption 12-A's edge half breaks by putting a CDN in front of the origin.

Both are the shape Phase 11 closed twice: a control built, proven, never wired.

### Route classes and policy

Limits live in one table keyed by route CLASS, so a new endpoint inherits a
reviewed policy by declaring what kind of thing it is rather than by copying a
number.

| Class | Limit | Window | On Redis outage | Routes |
| --- | --- | --- | --- | --- |
| `paid_compute` | 12 | 60s | **closed** | `generate`, `orchestration/execute`, `generations/[id]/execute`, and the five `orchestration/*` AI endpoints |
| `durable_write` | 30 | 60s | **closed** | `media/upload-url`, `generations/[id]/cancel` |
| `authenticated_read` | 120 | 60s | open | `models` |
| `realtime_connect` | 20 | 300s | **closed** | `realtime/events` |
| `public_dev_stub` | 30 | 60s | open | `generate-video`, `generate-video/[jobId]` |

Rationale is recorded beside the table in `route-rate-limit.ts`. In short: a
person iterating on a prompt submits every few seconds, so twelve a minute
leaves room for impatience while capping a scripted loop two orders of
magnitude below what it would otherwise reach; the SSE gateway ends every
connection at ~50s so a healthy client reconnects about six times in five
minutes, and twenty absorbs several tabs plus a deploy-driven reconnect storm.

### Fail-closed is per class, and argued

**Closed** wherever a request can spend money or create durable work. An
outage is exactly when an unlimited paid path is most dangerous, and a refusal
is recoverable while an unbilled provider run is not.

**Open** only for `authenticated_read` (a catalog query; worst case is a wasted
read) and `public_dev_stub` (in-memory, no cost, no database). Both are named
explicitly in the table and asserted by test, so a future class inherits
nothing by accident. There is no universal behaviour and no in-memory
fallback — a process-local counter on serverless is not a limit.

### Identity is server-derived

Authenticated routes count against the Clerk user id from `auth()`. Anonymous
routes count against a hashed, platform-trusted address: `x-vercel-forwarded-for`,
then `x-real-ip`, then the **last** hop of `x-forwarded-for` — never the first,
because the first entry is whatever the client claimed. Proven live: two
requests rotating a spoofed first hop share one bucket.

An authenticated route with no user id does **not** fall back to an address.
That would let a caller who dropped their session share a bucket with everyone
behind their NAT, or escape their own; it is refused instead.

### The 429 says one useful thing

A fixed body of `{error, message}` plus `Retry-After`. Not included: the count,
the ceiling, the window, the bucket, the Redis key, the subject kind, the user
id, the address hash. A caller who learns it hit an IP ceiling rather than a
user ceiling has learned something about the other people behind its NAT; a
caller who learns the limit has learned how to sit just under it. A test
asserts the body contains **no digit at all**.

### The limit precedes every side effect

`guardRoute` returns a `Response` and the route's next statement is
`return limited`, so on a paid path the handler has not begun. A refusal
therefore cannot have created a generation, reserved a credit, started a
workflow or called a provider. A structural test scans every route and fails
if any of those symbols appears before the guard.

### Private cache

`privateJson` replaces `NextResponse.json` in every route, emitting
`private, no-store, no-cache, must-revalidate, max-age=0` plus `Pragma` and
`Expires` for intermediaries old enough to ignore `Cache-Control`. A test fails
if any route returns a raw `NextResponse.json`.

Public immutable assets are untouched: the helper is applied per route, and
neither `next.config.ts` nor `proxy.ts` blanket-privatises anything, so hashed
static bundles keep their CDN caching.

### Relation to Phase 11-D, and to the future edge

11-D counts **concurrent SSE connections** a tenant holds. This counts
**requests over a window**. A client can be inside one and outside the other,
which is why both exist; the limiter may not touch a connection lease and a
test asserts it does not. The one thing they deliberately share is the IP
derivation, because two controls disagreeing about a caller's address would be
worse than either.

Cloudflare and Vercel Firewall will sit in front of this and stop crude floods
before a function runs. They cannot replace it: an edge rule counts by IP and
knows nothing about which user is spending, which endpoint costs money, or
whether a request creates durable work. This layer survives an attacker already
past the edge.

### The 12-C seam

`setRateLimitObserver` exists so Phase 12-C can normalize `rate_limit.denied`
into `security.events` without reopening fourteen routes. **Nothing observes by
default and nothing is emitted** — no fake security producer was added. The
seam's payload carries the route class and the subject KIND, never a user id or
an address.

### Residual risk

- **This is the application half only.** Cloudflare DNS/CDN/WAF/DDoS,
  Turnstile, Vercel Firewall and the origin-bypass test are 12-A's edge half
  and remain `BLOCKED_UNTIL_DOMAIN`. **12-A is not complete.**
- **Fixed-window, not sliding.** A caller can send the limit at the end of one
  window and again at the start of the next. That is the store's existing
  design and is adequate against runaway loops and accidental retries; a
  determined attacker shaping traffic to window edges is the edge layer's
  problem, and the doubling is bounded at 2x.
- **No admin routes exist yet to protect.** When Phase 16 adds them they must
  declare a class; the structural guard will fail if they do not.

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
| 6 | SQS IAM least privilege; worker distrusts queue messages | 6R-C · 12-D | **CORRECTED, Phase 18 audit.** Both halves are done, under the phases that actually built them — this row previously said `NOT_STARTED` under a stale `18-A` label; direct code/test verification during a Phase 18 reality audit found neither claim true. IAM least privilege: `infra/modules/iam/main.tf` (per-runtime roles, no `Action`/`Resource` wildcards, DR backup role holds no `DeleteObject`, media worker role holds no `ListBucket`), proven by `phase-12d-secret-environment.e2e.test.ts` (26/26 passing) and documented in `docs/security/least-privilege.md` — not yet *applied* to a live AWS account (that adoption step is its own deliberate, unstarted change, per the production Terraform root's own header comment), but the least-privilege design itself is real and tested, not absent. Worker distrusts queue messages: `worker/provider-worker.ts` parses every message body through `parseCommand()` (`src/lib/contracts/command-wire.ts`) before acting on it — a schema-invalid body is classified `poison_message` and left for the DLQ, never handed to a provider — with the comment "a queue message is not an authority" attributing this discipline to Phase 6R-C. |
| 7–10, 12 | — | — | NOT_STARTED |
| 11 | AI/MCP write authority default-off; tool-level allowlist; production write only via policy + human approval | 14-x · 19-x | PARTIAL — the allowlist mechanism and its first entry (`code.pr.create`, PR-creation-scoped, still human-approval-gated) exist and are proven by conformance test as of Phase 14-B. No GitHub integration exists to actually open a PR, no production-write action is allow-listed, and 14-A/14-C/14-D/14-E/14-F remain unbuilt. |

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

## Health surface exposure (Phase 13 health foundation)

Health checks are an information-disclosure surface as much as an operational
one, so the exposure decision is recorded here rather than left to whoever adds
the next endpoint.

**One public endpoint, minimum information.**

```
GET /api/health/live      PUBLIC     {status, timestamp} — nothing else
readiness()               server-only, NO ROUTE
dependencyHealth()        server-only, NO ROUTE
```

`/api/health/live` performs no dependency check and returns no version, build
id, region, runtime name or dependency list. A monitor needs a 200 and a body
it can match; everything past that is disclosure with no consumer.

Readiness and dependency health are deliberately unrouted. An unauthenticated
readiness endpoint enumerates which subsystems are unwell — which database,
which queue, which cache — which is simultaneously a map of the architecture
and a list of what is currently weakest. 12-D made the same call for
`configurationHealth()`.

**The route took no exemption.** Its first version skipped `guardRoute` and
returned a raw `NextResponse.json`, arguing that a liveness probe should never
be refused. PRE-12's structural guards rejected it, correctly — a route that
opts out of the rate limiter and the cache contract is exactly how those guards
stop meaning anything. The fix went into the policy table instead: a new
`public_health` route class.

| Class | Anonymous | Limit | On limiter unavailable |
| --- | --- | --- | --- |
| `public_health` | yes | 240 / 60s | **open** |

Fail-open is the point. An uptime monitor uses two requests a minute against a
budget of 240, so the limit only catches abuse; and a Redis outage must not be
able to make liveness fail, because a failed liveness answer is a restart. The
fail-open pin in `phase-12-pre-rate-limit.e2e.test.ts` was updated deliberately
to `["authenticated_read", "public_dev_stub", "public_health"]`, with a
companion assertion that every other class still fails closed.

**Probes cannot be used to reach anything.** `src/lib/health/` imports the
contract, the probes and the logger, and nothing that could restart a
generation, retry a provider, settle a credit or release a quarantine. Probes
are read-only: a read-only RPC for Supabase, `PING` + `CONFIG GET` for Redis A,
one bounded `SCAN` for provider health (never `KEYS`), config presence for the
rest. Health output carries no URL, host, credential or raw latency — latency
is reported as a bucket (`fast` / `normal` / `slow` / `timeout`), and reasons
are a closed set of codes, so the 13-E telemetry allow-list has nothing to
strip.

**Not covered by this package.** 13-C remains open: no external uptime monitor,
no synthetic checks, no worker heartbeat, no alerting on `UNREADY`, no public
status page. No Better Stack, Datadog, Sentry or OpenTelemetry exporter is
configured, and no DSN or API key for one exists in the repository. Health is
currently observable only from inside the process.

## Alert router (Phase 13-D, code half)

`src/lib/alerts/` normalizes, deduplicates, correlates and routes internal
signals into a symbolic channel decision. It does not deliver anywhere — no
Telegram bot, no status page, no webhook, no token, no network call anywhere
in the directory. A test scans the source and fails if a network call, a
webhook host or a bot token pattern appears.

**What crosses the boundary from a producer to an alert is a fixed
allow-list**, exactly like the 13-E telemetry guard: `alertId`, `type`,
`source`, `severity`, `resource`, `reasonCode`, `dedupeKey`, `state`,
`firstSeen`, `lastSeen`, `occurrenceCount`, `channels`, `correlation` — and
nothing else. A producer that passes a prompt, a signed URL, a raw error
object or a security-evidence row has it silently dropped by
`normalizeCorrelation`/the envelope constructor, not merely discouraged.
`resource` and `reasonCode` are pattern-checked (`^[a-z][a-z0-9_-]{0,63}$` /
`^[a-z][a-z0-9_]{1,64}$`) before anything is built, so neither can hold a URL,
an address, an email or free text — a candidate that fails either check is
rejected outright, before a dedupe key or a log line is ever produced.

**Severity is server-derived from one catalogue** (`ALERT_CATALOGUE`), never
parsed from text and never accepted from a candidate — `raiseAlert` reads
`ALERT_CATALOGUE[type].severity` and ignores any `severity` field a caller
supplies (S13D-2 pins this by forging one and asserting it is overridden).

**Deduplication:** key is `source:type:resource` only — never an occurrence
id, trace id or timestamp, which would make every repeat look distinct.
Inside the type's window, repeats increment a count and deliver nothing.
Suppression is not permanent: an escalation ladder (10 / 100 / 1,000 /
10,000 occurrences) re-emits once per threshold crossed, and a `CRITICAL`
alert re-emits after 300 seconds of silence regardless of the ladder, so a
sustained critical failure cannot read the same as one that recovered.

**Routing** (`channelsFor`): `DASHBOARD` always; `TELEGRAM` added at
`ERROR`/`CRITICAL`; `STATUS_PAGE` added only when severity is `CRITICAL` **and**
the catalogue marks the type user-visible. Every security alert type is
`CRITICAL` and explicitly `userVisible: false` — publishing a security event
on a public status page would confirm to whoever triggered it that the probe
landed, and disclose which internal subsystem noticed. Only one alert type in
the whole catalogue (`runtime_unready`) is user-visible, because a whole
runtime failing is the one internal signal users eventually feel anyway.

**The only implemented sink is `LoggingAlertSink`.** It writes through the
existing 13-E-guarded structured logger and makes no outbound call.
`TelegramAlertSink`, `StatusPageSink` and any Datadog/Sentry bridge are named
in `AlertDeliverySink`'s own doc comment as the unbuilt external half of
13-D — a test asserts exactly one class in `alert-sink.ts` implements the
interface and that its name is `LoggingAlertSink`.

**Real production callers, not a library nobody imports:**

| Caller | What it raises | When |
| --- | --- | --- |
| `security-event-logger.ts` | `security_high_severity`, `security_action_recommended` | After every newly *recorded* (non-coalesced) row — 12-C's own storm control decides what counts as new, and the alert layer does not re-decide it |
| `worker/realtime-dispatcher-worker.ts` | health-transition, outbox-debt, dispatcher-failure alerts | Once a minute, alongside the existing debt log; a throwing alert call is caught and cannot break the dispatch loop |

**Catalogue-vs-producer coverage is asserted in both directions.** Every
alert type in `ALERT_CATALOGUE` has a real `raiseAlert`/`resolveAlert` call
site in `alert-sources.ts`, and every type a producer can raise is in the
catalogue — this repository has found "component exists, nothing calls it"
five times now (D-11-1, D-12-1, the 12-C logger near-miss, D12-D2, the
LOCAL_PREVIEW guard), and an alert type with no producer is the same defect
restated as an entry in a table.

**Signals named in the roadmap with no producer today are left out of the
catalogue entirely**, not stubbed: workflow-start outbox debt (no debt
aggregate exists yet), DR backup debt (no backup job runs yet), SQS/DLQ depth
(no metrics client), Kafka lag (activation-ready only), replay-gap spikes. An
alert type nothing can raise would sit permanently silent and read as
"healthy" to whoever checked it — worse than not having the type.

**A defect the live local proof caught, with a standing regression test.**
`dependencyHealth()` still probes `OPTIONAL`/`DEFERRED` dependencies for the
diagnostic view even though `rollUp()` excludes them from readiness — so
Kafka and Redis B report `UNKNOWN` on every poll forever, by design, since
their probes deliberately do no I/O yet. The first version of
`alertOnReadiness` alerted on any dependency at `UNKNOWN` regardless of
criticality, so a plain worker startup — zero actual incidents — paged three
`ERROR`/`TELEGRAM` alerts for infrastructure that was never meant to be
running. Fixed with the same one-line guard `rollUp()` already uses
(`criticality === "OPTIONAL" || criticality === "DEFERRED"` → skip), and
`S13D-12b` pins it so the alert layer cannot silently know more than the
health contract already decided.

**Failure semantics.** `raiseAlert` never throws to its caller; a sink that
throws is caught inside `dispatchToSinks` and never propagates. Neither
production caller can have its own behaviour altered by an alerting fault —
the security logger still writes its row and returns its result regardless of
whether the alert raise succeeded, and the dispatcher wraps its alert calls
separately from its dispatch pass. `src/lib/alerts/` imports no Supabase
client, no Temporal client, nothing that touches credit, settlement,
quarantine or a provider adapter.

**Not covered by this package.** No Telegram bot exists. No
`status.cinefield.ai` exists. No Better Stack, Datadog or Sentry account was
created and none is configured. The `ACKNOWLEDGED` alert-lifecycle state is
defined in the type but has no code path that can produce it — acknowledgement
needs a human and an operator surface, which is Phase 16; a router that
acknowledged its own alerts would be marking its own homework.

## Phase 14-B — AI PR-scoped authority, change-risk taxonomy, required-check registry

Code-only. No GitHub API, no GitHub App/token, no branch, no commit, no PR,
no Sentry Seer, no Vercel Preview deployment, no production deploy, no
rollback execution. **14-A is NOT complete** — this is the safety foundation
14-A's real, external half would sit on top of, not 14-A itself.

### The AI PR-only boundary, machine-testable

`policies/data/actions.json` gained one entry: `code.pr.create` —
`requiredRoles: ["ai_agent"]`, `requiresHumanApproval: true`,
`requiresTwoPerson: false`, `implemented: true`, `owner: "phase-14"` — and
`aiWriteAllowlist` grew from `[]` to `["code.pr.create"]`. Every other action
remains denied by `ai_write_authority_off` exactly as before; the allowlist
did not open, it gained one narrowly-scoped, still-gated member.

**Direct-main-push deny, direct-production-deploy deny.** Neither action is
registered, allow-listed, or reachable — there is no `code.main.push`, no
`production.deploy`, no wildcard (`code.*`, `repository.*`) anywhere in the
registry, and a structural test asserts no registered action name even looks
like one. `code.pr.create` is the only AI-reachable action, and creating a
pull request is not pushing to main, merging, or deploying — those remain
undefined, unbuilt capabilities.

**AI self-approval deny.** No file in `src/lib/deployment/` contains
approval-granting code (`setApproved`, `grantApproval`, a hardcoded
`humanApproved: true`). `approvalEvidence` is supplied by the SERVER caller of
`evaluateAiPrProposal`, exactly as every other `requireAiWritePolicy` call
site already requires — a proposal's own input has no field that could carry
a self-asserted approval.

### Change-risk taxonomy (`src/lib/deployment/change-risk.ts`)

Four classes — `LOW_RISK`, `MEDIUM_RISK`, `HIGH_RISK`, `FORBIDDEN_AUTOMATION`
— derived from an ordered, most-severe-first table of REAL path prefixes in
this repository (not speculative ones), with the overall risk being the
maximum across every touched path. Unknown paths default to `MEDIUM_RISK`,
never `LOW_RISK` — the same "unknown != safe" posture as
`AMBIGUOUS != SAFE TO RETRY` and `UNKNOWN != HEALTHY` elsewhere in this
document.

**`FORBIDDEN_AUTOMATION`**: `src/lib/policy/` and `policies/` (the policy
engine and its own registry — an AI Fix Agent cannot propose editing its own
allowlist), `src/lib/config/` and `.env*` (secrets/config validation),
`infra/` / `terraform/` / `.github/workflows/` (production infrastructure and
CI configuration, reserved even though these directories don't exist yet),
`src/lib/media/quarantine-release.ts` (the quarantine override mechanism
itself).

**`HIGH_RISK`**: `supabase/migrations/` (schema and RLS both live here; a
migration is never markable low), `worker/` and
`src/lib/orchestration/` outside `providers/` (generation lifecycle, queue
ownership), `src/lib/security/` and `src/proxy.ts` (auth), moderation code,
billing/credit code, admin-path UI or routes, the upload-URL route, and the
generation-facing API route surface.

**`MEDIUM_RISK`**: `src/lib/orchestration/providers/` specifically — provider
ADAPTER logic, distinct from provider SUBMISSION (the parent directory,
`HIGH_RISK`), matching the roadmap's own explicit separation of the two.

**`LOW_RISK`**: documentation and test fixtures only.

Risk is **never** accepted from a caller. `classifyChangeRisk` takes exactly
one parameter — the changed file paths — and there is no field anywhere in
`PrProposalInput` for a risk claim; a `riskClass` an AI proposal tried to
smuggle in is structurally impossible to construct, let alone honor.

### Required CI check registry (`src/lib/deployment/required-checks.ts`)

Ten check ids, each mapped to a REAL runnable command in this repository:
`typecheck` (`tsc --noEmit`), `test_suite` (the combined `node:test` run —
this repo has no separate "unit only" command), `build` (`next build`),
`changed_file_lint` (scoped `eslint`), `secret_scan`, `telemetry_scan`,
`policy_conformance` (`opa test`, a genuinely separate toolchain), plus
`migration_safety` and `postgres_proofs` (required whenever
`supabase/migrations/` is touched, regardless of computed risk tier) and
`dependency_review` — registered because the roadmap names it, marked
`status: "deferred"` because no Dependabot/GitHub dependency-review tool is
wired yet, and never resolved as required. A deferred check is never reported
as passing.

**`migration_safety` was made real in Phase 14-A.** It shipped in 14-B marked
`status: "available"` while its `command` was the parenthetical string
"(static review of touched supabase/migrations/ files)" — a description of a
human reading files, not something a runner can execute. The Phase 14 post-14B
audit flagged that as a real (LOW) defect: a registry that names a check,
marks it available, and has nothing behind it misreports its own coverage.
It now names `npx tsx scripts/scan-migration-safety.ts`, a real scanner in the
same shape as the secret and telemetry ones.

That scanner flags destructive SQL SHAPES — `DROP TABLE`/`COLUMN`/`SCHEMA`/
`DATABASE`, statement-position `TRUNCATE`, unqualified `DELETE FROM`, and
in-place column retype — and deliberately does NOT flag `DROP POLICY`,
`DROP FUNCTION`, `DROP TRIGGER` or `DROP CONSTRAINT`, all of which appear
legitimately here and change rules rather than rows. Two false-positive traps
are closed by construction: SQL comments are blanked before matching (one
migration's header literally reads "TRUNCATE removal"), and `TRUNCATE` counts
only in statement position, because as a bare word it is also a PRIVILEGE
name — `GRANT ...,TRUNCATE,...` and `REVOKE TRUNCATE ON ALL TABLES` are grant
management, and the latter *removes* the ability to truncate.

It proves a narrow thing, and says so: it cannot prove a migration is correct
or reversible, and it cannot see whether an already-applied migration was
rewritten, because applied state lives in the database rather than the files.
`postgres_proofs` and human review cover those. A test asserts that no
registry entry may claim `available` while its command is a parenthetical
description, so this class of defect cannot recur silently.

`resolveRequiredChecks(riskClass, changedFilePaths)` takes exactly those two
server-computed arguments — no third parameter exists for a caller's
preference, and a regression test asserts the function's own arity and that
neither its signature nor `PrProposalInput`'s shape contains a
skip/exclude/preference-shaped field.

### PR proposal contract and deployment-state separation

`PrProposalInput` (what a future AI Fix Agent would submit) and
`PrProposalRecord` (what the server computes) are deliberately two different
shapes. The input has a title, a bounded summary, changed file paths, an
optional correlation id, and a rollback-expectation enum — no risk field, no
check-selection field, no file contents, nothing secret- or URL-shaped. The
record adds the computed risk class, the resolved required checks, the
policy decision (or `null` for `FORBIDDEN_AUTOMATION`, which never reaches
the gate), and a lifecycle state.

**`PR_ELIGIBLE` is not `DEPLOY_ELIGIBLE`.** The four states —
`PATCH_PROPOSED`, `PR_ELIGIBLE`, `CI_BLOCKED`, `REVIEW_REQUIRED` — describe
whether an AI Fix Agent may have a pull request opened for human review.
None of them describe production readiness; 14-C (pre-prod validation) and
14-D (Deploy Guard / Rollback Guard) are separate, unbuilt packages that
would gate the much larger step from an open PR to a production deployment.

### Composition, not a second policy engine

`src/lib/deployment/ai-pr-authority.ts`'s `evaluateAiPrProposal` classifies
risk, resolves required checks, and — for anything not
`FORBIDDEN_AUTOMATION` — calls the EXISTING `requireAiWritePolicy` from
`policy-gate.ts` unmodified. It does not reimplement policy evaluation, risk
resolution, or audit logging; all three are inherited for free, including
`requireAiWritePolicy`'s existing real risk-state fetch and its unconditional
`reportPolicyDecision` audit-trail write. `PolicyDenied` is caught by
`instanceof`, never by matching a message string, and converted into
`REVIEW_REQUIRED`; any other thrown error propagates rather than being
reinterpreted as a proposal state.

**`FORBIDDEN_AUTOMATION` never reaches the policy gate at all** — the
strongest available guarantee, because it is structural rather than a
runtime check: the code path returns before `requireAiWritePolicy` is called,
so no future policy change could turn a forbidden change into an `ALLOW` by
accident. There is no branch through which it could.

### Human approval boundary

PR creation is not approval. CI passing is not approval. An AI's own
recommendation is not approval. `approvalEvidence.humanApproved` is supplied
by the server caller from durable state — nothing in this batch produces that
state; the workflow that would is Phase 16's, unbuilt. Every real call this
batch's own tests make resolves to `REQUIRE_APPROVAL`, the first genuinely
live producer of that decision (see the Residual Risk correction above); its
`ALLOW` branch is proven by test with synthetic approval evidence, the same
way `phase-12e-policy-gate.e2e.test.ts` test 13 proves `media.quarantine.
release`'s `ALLOW` branch without releasing anything.

## Phase 14-A — incident → diagnosis → fix-proposal seam (code-only)

Completes the first arrow of the roadmap's canonical self-healing chain and
stops there:

```
AlertEnvelope (13-D) → IncidentDiagnosis (14-A) → PrProposalInput (14-B)
  → change-risk (14-B) → policy gate (12-E) → REVIEW_REQUIRED
```

Everything after PR eligibility — branch, commit, push, open PR, merge, deploy
— is 14-A's external half and is **NOT built**. No GitHub SDK, no token, no
`gh`, no network call, and no new dependency; asserted by a directory sweep.

### Diagnosis is evidence, never authority

`IncidentDiagnosis` has no field for a risk class, a required check, an
approval or a deploy flag — a structural guarantee rather than a runtime rule.
The bridge that turns a diagnosis into a `PrProposalInput` cannot supply them
either, because 14-B's input shape has no field for any of them. Risk is
re-derived from the candidate paths by 14-B's classifier and approval comes
from a human, so a diagnosis that was confident and wrong cannot make a change
cheaper to land. A test proves the point adversarially: a forged provider that
claims `confidence: "high"` over `policies/data/actions.json` still classifies
`FORBIDDEN_AUTOMATION`.

### Sentry Seer is not here, and the seam does not pretend otherwise

`LocalDeterministicRootCauseProvider` is a lookup table over the 13-D alert
catalogue. It performs no inference, calls no model and reaches no network;
it declares `external: false`, and a test asserts it. Roadmap ¶111/¶753 place
Seer among the scale-triggered layers ("ihtiyaç/ölçek sinyallerine göre
aktive edilir"), so its absence is the roadmap's position, not a gap. The
`RootCauseProvider` interface exists so a future `SentrySeerRootCauseProvider`
drops in without any consumer changing — the same seam shape `TelemetrySink`
(13-A) and `AlertDeliverySink` (13-D) already use.

**SENTRY_SEER_STATUS: BLOCKED_EXTERNAL.** When it activates it may consume
only 13-E-compatible sanitized input; raw production telemetry must never
reach an external RCA.

### Eligibility: most incidents are NOT remediation candidates

Exactly one alert type is remediation-eligible today — `dispatcher_pass_failing`,
which is "bounded dispatcher failure with code ownership": the loop and its
transport both live in this repository, the failure is deterministic, and the
blast radius of a wrong guess is a PR a human still has to read.

Everything else returns `HUMAN_INVESTIGATION_REQUIRED`, conservatively and on
purpose. Security and infrastructure incidents are `FORBIDDEN_AUTOMATION` in
the change-risk taxonomy, so proposing code changes for them would be
proposing exactly what the taxonomy refuses to automate; an operational
backlog is as likely to be load as a bug; a degraded provider is someone
else's code. An uncatalogued alert type returns `ANALYSIS_UNAVAILABLE` rather
than a guess.

### Candidate path safety

Provider-supplied paths are normalized and filtered: traversal, absolute
paths (POSIX and Windows), `.env*`, `node_modules/`, `.git/`, `.next/`,
`CinefieldAI/`, and credential/key/pem shapes are all DROPPED — not repaired,
because a path that needed rewriting to be safe is a path nobody reviewed.

Worth recording: 14-B's `CHANGE_PATH_PATTERN` is `[a-zA-Z0-9_./-]{1,256}`,
which **permits `../`** — every character of a traversal sequence is in its
allowed set. That was harmless while paths came only from a trusted caller,
but a diagnosis provider is precisely the component that becomes an external
model later, so traversal is rejected explicitly here rather than assumed
impossible upstream. A test pins that premise so the reasoning survives.

### Failure semantics and loop-safety preparation

A throwing provider yields `ANALYSIS_UNAVAILABLE`; nothing throws into a
caller. The seam performs no database mutation and cannot reach the money path
(asserted by sweep). It carries 13-D's `dedupeKey` and `occurrenceCount`
unchanged, so Phase 14-F's future dedupe, cooldown and attempt limits have a
stable incident identity to key off — re-deriving a second identity here would
guarantee the two disagree.

### No production caller yet, deliberately

The seam is callable and tested, but the 13-D Alert Router does **not**
auto-invoke it. Phase 14-F owns the global auto-remediation kill-switch and
the Seer/agent PR-storm rate limit, and neither exists yet; wiring automatic
proposal generation before those land would create exactly the unbounded-PR
failure 14-F is specified to prevent (¶253–259: those three additions exist
"AI ops'un kendisi sapıttığında"). This is the same guardrail-before-capability
order `requireAiWritePolicy` and the alert sinks already followed.

## Phase 14 F/C/E/D — the safe-deployment chain (code-only)

Implemented in the order **F → C → E → D**, not package lettering. 14-A was
deliberately unwired until F bounded the loop; C is a pure decision model that
needs no Vercel; E must exist before D, because a Deployment Guard that
approves a release without asking what is being deployed verifies the process
and never the payload.

**No external integration is active.** No GitHub API/token, no Sentry, no
Vercel call, no deploy, no rollback execution, no Telegram. Every stage is a
decision model; the acting systems are deferred.

### 14-F — the remediation loop is bounded

**Kill switch, default ENGAGED.** `CINEFIELD_AUTO_REMEDIATION_ENABLED` must
equal exactly `"true"`; anything else — absent, `"1"`, `"yes"`, a typo —
leaves remediation frozen. A fresh deployment that has never heard of the
variable does not quietly begin opening PRs.

There is deliberately **no setter, no enable function, no override parameter
and no API route**. An env var can only be changed by someone who can change
the deployment's configuration; a database row can be written by anything
holding a service-role client, and a route can be called. A test sweeps the
whole module *and* `src/app/api` for any of these. It is also **not** the same
control as the provider-routing kill switch — disabling a flaky provider must
not also disable the brake on the automation.

**Limits** (small on purpose; the cost of being wrong is asymmetric): 3
attempts per incident ever, 1-hour cooldown between them, 5 attempts per hour
globally, 1000 tracked incidents. The **global** ceiling is what actually
stops an alert storm across twenty distinct resources from fanning out into
twenty proposals — per-incident limits alone permit exactly that.

Identity is **reused, not re-derived**: 13-D's `dedupeKey`
(`source:type:resource`) and `occurrenceCount`, carried unchanged through
14-A. A second identity would eventually disagree with the first.

**Provenance** records incident identity, actor class, agent, attempt number,
decision, reason code, policy version and risk class through the 13-E guarded
logger. Two fields would have been silently dropped by the redactor and were
caught before landing: `dedupeKey` contains colons while `correlationId` is an
`id` field forbidding them, and `"forbidden_automation"` is 20 characters
against `severity`'s 16-character cap. The allow-list gained a `dedupeKey`
entry (kind `name`, which permits colons) and risk moved to `classification`
— neither value was mangled to fit.

**The bounded caller is the dispatcher worker, not the alert router.** Wiring
the router would make every alert a remediation candidate, which is how "one
eligible type" quietly becomes all of them. The guardrail runs *before* the
14-A seam, so a frozen system does no diagnosis work and a storm does not
produce N diagnoses before N refusals.

### 14-C — preview candidate gate

Three eligibilities stay distinct because conflating any two is the failure
the separation prevents:

```
PR_ELIGIBLE      (14-B) may a pull request be opened?
PREVIEW_ELIGIBLE (14-C) may a preview be built and tested?
PROD_CANDIDATE   (14-C) has it earned being CONSIDERED for deployment?
```

None implies the next, and `PROD_CANDIDATE` is still not permission to deploy.

**Absence is never a pass.** A required check with no recorded outcome is a
refusal, as are `pending` and `skipped`. Deferred checks (no tool exists) are
neither counted as passing nor allowed to block — reporting an unrunnable
check as passed is the defect 14-A closed for `migration_safety`.

`DEGRADED` readiness is acceptable, matching Phase 13's own `isReady()`;
`UNREADY` and `UNKNOWN` block (`UNKNOWN != HEALTHY`). An open critical
security alert blocks however green the build is. `FORBIDDEN_AUTOMATION` can
never reach candidate, and `HIGH_RISK` needs human approval even with
everything mechanical green — green checks answer "does it work", not
"should we".

### 14-E — artifact verification

**Identity is the digest.** A filename is not an identity (two builds produce
the same one) and neither is a PR number (it identifies an intent to change,
not the bytes); the shape has no field for either.

Fails closed in every direction — missing artifact, missing/malformed digest,
`UNKNOWN` status, digest mismatch, commit mismatch, lineage mismatch, missing
provenance. `verified: true` is returned from exactly one expression, guarded
on the refusal list being empty; there is no default-allow branch.

`UNKNOWN` blocks under its own code rather than folded into `UNVERIFIED` —
"we asked and the answer was no" and "we could not find out" mean different
things, and the second usually means something is misconfigured.

**Lineage binding** stops a stale-but-verified artifact from an earlier green
build riding along with a newer commit; same digest and status would otherwise
pass.

**Phase 24 is not duplicated**: no signing, key material, SBOM generation,
attestation issuance or transparency log. This consumes a provenance
reference; Phase 24 issues one.

### 14-D — deployment guard and rollback guard

Deployment eligibility requires **all** of: 14-C candidate, 14-E verified
artifact, green CI, human approval where risk demands it, no critical security
alert, healthy readiness. The guard **re-runs** 14-E verification against the
current candidate rather than trusting a cached boolean — a verdict computed
earlier against a different claim is the stale-approval hazard lineage
checking exists to catch.

Rollback triggers on **Phase 13 signals only**; there is no field for an AI
opinion. Readiness failure REQUIRES rollback; an alert alone RECOMMENDS it.

**"Roll back to latest" is not a decision this can make.** Without a known
`verifiedGood` previous deployment the verdict is `REVIEW_REQUIRED` even when
the current release is plainly unhealthy — rolling into an unknown state is
not a recovery, and an automated wrong guess can take the product down twice
while a human deciding takes minutes. A test asserts the guard never reasons
about a "latest" deployment at all.

Rollback cannot start the remediation loop, reach billing, or touch the
provider path.

### Still deferred after this batch

GitHub App/token, branch protection, Dependabot, real branch/commit/PR
creation; Sentry Seer; Vercel project, Preview and deployment checks; real
production deploy and rollback execution; Telegram and status page; custom
domain. **Phase 14 is not production-complete** — its decision layer is.

## Phase 15-A — SLI / SLO + error budget (code-only)

Roadmap 15-A: *"SLO/Error Budget metriklerini ve alert eşiklerini tanımla."*
Done-criterion: availability / success / p95 / timeout / queue-age targets are
measurable.

Turkish, because the roadmap is: **SLI** = ölçülen hizmet göstergesi ·
**SLO** = hedeflenen hizmet seviyesi · **error budget** = kabul edilen hata
payı · **burn rate** = hata payının ne hızla tüketildiği.

### Definitions, not proof of compliance

`SLO_TARGETS` is a **policy statement**. Nothing in Phase 15-A asserts that
production meets any objective — live measurement needs an external metrics
backend (Datadog / Better Stack / Sentry), all of which remain **deferred**.
No number in this phase may be read as "the SLO is being met".

### Phase 15-A owns definitions and arithmetic. Nothing else.

Every SLI names ONE canonical source that already exists and is owned
elsewhere:

| SLI | Source | Owner |
|---|---|---|
| `app_availability`, `dependency_readiness` | readiness reports | **Phase 13 Health** |
| `generation_success_ratio`, `generation_latency_p95`, `generation_timeout_ratio` | `generation_attempts` | Temporal / durable attempt evidence |
| `realtime_debt_age` | `realtime_outbox_debt()` | existing debt aggregate |
| `provider_reliability` | provider health store | **Phase 7** |

It computes no second opinion about any of them. A second provider-health
score would eventually disagree with the router's own, and then "is this
provider healthy?" would have two answers depending on who was asked.

### UNKNOWN is never HEALTHY

Five states — `HEALTHY`, `AT_RISK`, `BREACHED`, `INSUFFICIENT_DATA`,
`UNAVAILABLE`. `sourceAvailable` is checked **first** and is separate from the
counts, because a failed query and a genuinely empty window both produce zero
rows; collapsing them would turn a broken database connection into a perfect
score. A perfect ratio over three samples is `INSUFFICIENT_DATA`, not 100%. A
failed debt RPC is `UNAVAILABLE`, not "zero debt". This is the same rule Phase
13 applies to dependency health and 14-E to artifacts.

### NaN and Infinity are impossible by construction

Every division guards its denominator; every input is validated; every return
is a finite number or an explicit "cannot compute". This matters more than it
sounds: **a NaN burn rate compares false against every threshold**, so a broken
calculation would silently read as "not breaching" — failing open on exactly
the signal meant to say something is wrong.

The **100% target is a real case, not an edge case**: `dependency_readiness`
targets 1.0, making `allowed_bad` exactly zero. It is handled explicitly —
with no budget to spend, any bad observation is total exhaustion — rather than
computing 0/0. Burn rate for that case returns `not_applicable`, never
`Infinity`, because "infinitely fast" is not a number a threshold can be
written against.

### It is not an alert router

`slo-alert-bridge.ts` has no dedupe state, no severity table, no channel
logic, no escalation ladder and no delivery. It converts a snapshot into a
candidate and hands it to **13-D's** `raiseAlert`. Severity lives in 13-D's
catalogue (`slo_budget_low` = WARNING, `slo_budget_exhausted` = ERROR); this
file chooses which catalogued type applies and cannot make one louder.

An SLO breach is `userVisible: false` — an SLO is an internal commitment, and
publishing which objective slipped tells an outsider where the system is
weakest.

`INSUFFICIENT_DATA` and `UNAVAILABLE` raise **nothing** and resolve
**nothing**: "we could not measure" is neither a breach nor a recovery.

The producer lives in `src/lib/slo/` rather than `alert-sources.ts` because
Phase 15-A owns the SLO signal and depends on 13-D — the correct direction.
13-D's producer-coverage guard was widened to scan producers wherever they
live; the guarantee is unchanged and its scope is larger.

### Cardinality is bounded

Allowed dimensions are `provider`, `modelId`, `dependency` — closed catalogues
that already exist. There is deliberately **no** user, workspace, tenant,
request, generation or error-message dimension. That is not a storage
optimisation: a per-user metric label is both an unbounded series count and a
way for identity to reach a metrics backend. A dimension outside an SLI's
allow-list, or a value that does not match the bounded pattern, is **dropped**
rather than honoured. Correlation ids belong in traces and logs, where they
are already allow-listed — not in metric labels.

Phase 15-A required **no new 13-E allow-list field**.

### Not in this batch

15-C DR restore-verification, 15-D DLQ redrive / RTO-RPO / chaos. Live
measurement, dashboards (Phase 16) and any external exporter remain deferred.
**Phase 15 is not complete.**

## Phase 15-B/1 — FinOps cost observation + budget evaluation (code-only)

Roadmap 15-B: *"provider cost + credits + Stripe + generation volume
korelasyonu + provider hard budget cap + reversible route/kill-switch kur."*
This batch is the first slice of it and does not close the package.

`src/lib/finops/` — `cost-contract.ts`, `cost-budget.ts`, `cost-guard.ts`,
`cost-alert-bridge.ts`. All pure: no I/O, no clock, no database, no network.

### Every cost number here is an ESTIMATE

`generation_attempts.cost_amount` and `cost_currency` exist in the schema, but
**no production caller writes them**, so this system records no observed
provider spend at all. Everything Phase 15-B/1 produces is derived from
`model_pricing` — a price list — times a unit count. That is a forecast of
what a provider will probably charge, not a record of what one did charge.

`CostBasis` makes this a value (`ESTIMATE_BASED` / `OBSERVED_ACTUAL`) rather
than a comment, and it is emitted with every cost log line. Nothing in this
batch can produce `OBSERVED_ACTUAL`, and a test asserts no code path does.
Writing `cost_amount` at settlement touches the Phase 10 settlement path and
belongs in its own reviewed batch.

### Three numbers that must never merge

| number | meaning | owner |
| --- | --- | --- |
| `provider_unit_cost` | what a provider charges Cinefield | **Phase 15-B** |
| `credit_price_per_unit` | what a customer is charged | **Phase 10** |
| invoice total | what a bank statement says | **external — DEFERRED_EXTERNAL, not zero** |

`model_pricing` carries the first two side by side. Only the first is an
operational cost, and `src/lib/finops/` never reads the second — enforced
structurally, because a guard computed from the credit price would grow *less*
worried the more margin was charged. No Stripe, AWS Cost Explorer or provider
invoice figure exists anywhere in the package; external billing truth is
absent, and absent is represented as absent rather than as zero.

### UNKNOWN is not free, and uncertainty is not headroom

Missing pricing, an inactive row, a stale `verified_at`, an unknown model, a
malformed numeric and a failed repository read each resolve to a **named
non-numeric state** — never `estimatedCost: 0`. An aggregate containing one
unpriced member is unknown in total, not a partial sum, because a partial sum
understates spend by exactly the amount nobody could see.

`ALLOW` is withheld for every one of them, including **STALE**, which carries a
number but is not a basis for committing money. A currency mismatch fails
closed; no exchange rate is ever applied, because nobody has set one and a
guessed rate is a guessed spending limit. NaN and Infinity are impossible by
construction: a NaN ratio compares false against every threshold, so a broken
calculation would read as "under budget".

The budget registry (`COST_BUDGETS`) ships **empty on purpose**. A limit is a
business figure; inventing a plausible one would either throttle real traffic
or sit so high it never fires while looking like protection. `defineCostBudget`
validates any budget the moment one is added.

### It recommends. It does not act.

The guard returns a `decision` and, separately, a bounded `recommendation`
naming a **Phase 7** target. It never calls `setRoutingControl`,
`clearRoutingControl` or `setRuntimeRoutingControl`, never writes a runtime
flag, and never disables a provider or model — all four enforced by test.

**Phase 7 owns routing control.** The `provider-model` target id is Phase 7's
own `providerModelId`, carried verbatim; composing one from provider + model
would produce a string `findRuntimeExclusion` has never seen, so the
recommendation would look actionable and do nothing. `CostState` is likewise
built *from* Phase 7's union rather than copied beside it, and the unit and
freshness arithmetic delegates to `normalizeRoutingCost` so the router and the
guard cannot quote different numbers for the same request.

**Phase 21 owns generic feature flags.** No percentage rollout, canary,
segmentation or progressive delivery. The only thing borrowed is the target
vocabulary, as a type.

A `BUDGET_EXHAUSTED` recommendation follows the budget's **scope**, not the
observation's identity: a provider-model overrun recommends excluding that one
model, never the whole provider. A GLOBAL overrun recommends
`HUMAN_REVIEW_REQUIRED`, because no single target can be excluded to fix an
overrun caused by everything at once.

**No automatic provider disable exists yet.** Whether an automated cost signal
may take a provider offline unattended has not been decided by anyone, and
wiring the mutation now would answer it by accident — on the strength of an
estimate.

### Alerting and telemetry stay where they belong

**Phase 13-D** owns routing. Two new catalogued types, `cost_budget_at_risk`
(WARNING) and `cost_budget_exhausted` (ERROR), both `userVisible: false` —
what Cinefield pays a provider is commercial information, and publishing which
provider became expensive would expose supplier economics on a public status
page. Both are `remediationEligible: false` in Phase 14-A: cost pressure is a
business threshold being met, not proof of a code defect, and an agent asked
to "fix" it would patch the wrong system. An UNKNOWN decision raises nothing
**and resolves nothing** — going blind must not clear a standing breach.

**Phase 13-E** required six new allow-list fields, each justified individually
rather than by a blanket "cost" allowance: `projectedSpendMicros`,
`budgetLimitMicros`, `budgetRemainingMicros`, `currency`, `budgetScope`, `costBasis`.

Two boundary details worth knowing before adding a seventh:

- **Money is emitted in integer micro-units.** The redactor validates numeric
  fields as `count` and *rounds* them, so a USD 0.04 provider call logged as a
  float becomes `0` — a cost log claiming every request was free. Micro-units
  preserve the six decimals `numeric(12,6)` actually stores.
- **Enum labels are lowercased at the boundary.** `CODE_PATTERN` is
  lowercase-only, so `AT_RISK` would be **dropped**, not truncated, and the
  alert would arrive with no decision in it. The domain types keep their
  uppercase spelling; only the telemetry projection conforms.

Metric dimensions are limited to provider, modelId, budgetScope, currency and
classification. No user, workspace, generation, request or trace label.

### Budget precedence: the strictest verdict wins

GLOBAL, PROVIDER and PROVIDER_MODEL budgets can all govern one request.
`resolveApplicableBudgets` evaluates every applicable budget and returns **one**
verdict, so no caller is ever handed competing answers to choose between — the
combining rule is the entire safety property, and a caller that took the first
or the most permissive would let a healthy global budget overrule an exhausted
provider-model one.

Canonical strictness, lowest to highest:

```
ALLOW < AT_RISK < BUDGET_EXHAUSTED < UNKNOWN_COST < UNAVAILABLE < INVALID
```

Uncertainty outranks a **measured** overrun deliberately. BUDGET_EXHAUSTED is
bounded — the ceiling and the spend are both known. The three uncertainty
verdicts are not: the guard cannot say how far past a limit the traffic already
is, or whether a limit was evaluated at all. This is the only ordering under
which adding a budget can never make the system more permissive than it was
without one. Ordering *within* the three changes no permission; it exists so a
tie reports the same reason every time. `strictestVerdict` is commutative, so
registry order cannot change the answer.

A configured budget with no measured spend is **UNAVAILABLE**, never zero — an
unevaluated ceiling is not a satisfied one. A request that **no** budget
governs is ALLOW with `applicableCount: 0` and reason `no_applicable_budget`:
absence of a constraint is not a violation of one, and refusing traffic nobody
wrote a budget for would halt generation against today's empty registry, which
guarantees the guard gets bypassed rather than fixed. That case stays visible
in the result, so "within budget" and "no budget exists" are never confused —
it is a POLICY GAP, unlike an unreadable price, which is missing EVIDENCE and
does withhold permission.

### `generation_attempts.cost_amount` stays NULL until real evidence exists

The column must not be written from anything this package produces: not from
`model_pricing`, not from an estimated output count, not from a projected
window spend, not from a credit amount, not from a customer price.

The reason is not tidiness. A column named `cost_amount` holding an estimate is
indistinguishable, to every future reader, from one holding a bill — and the
readers that matter are invoice reconciliation and any later observed-spend
guard. Populating it with a forecast would not add data; it would permanently
and silently destroy the ability to tell forecast from fact.

The evidence does not exist today: `OrchestrationResult` carries no cost field
and no provider adapter returns usage or cost, so at settlement the only
knowable quantities are the inputs to the estimate. NULL is correct, and it is
correct on purpose. `markAttemptTerminal` already states the same rule from the
write side.

### Defects closed after the 15-B/1 post-implementation audit

| id | defect | resolution |
| --- | --- | --- |
| D1 | `tsc` failed — a test fixture used `state: "ACTIVE"`, not an `AlertState` | fixture corrected to `OPEN`; the assertion is unchanged, and `typecheck` (a required check) is green again |
| D2 | `aggregateCost([])` returned a priced zero, so a **failed** spend read looked like an empty window and reached ALLOW | `aggregateCost` now takes `{ observations, sourceAvailable }`, with `sourceAvailable` **required** and checked first; false yields UNAVAILABLE and no spend figure |
| D3 | no canonical precedence when several budgets applied; a caller could pick the most permissive | `resolveApplicableBudgets` + `VERDICT_STRICTNESS` + `strictestVerdict`, documented above |
| D4 | `costMicros` carried a projected window total but was named and documented as a per-request cost | renamed `projectedSpendMicros` across types, allow-list, tests and docs; the justification now describes a window projection |

### Not in this slice

Writing `cost_amount` at settlement; enabling any scheduled cadence
(`providerCostReconcileTask` stays a manually-invokable `task()`); actually
setting a routing control; real budget limits; Stripe / AWS / provider invoice
correlation; any UI (Phase 16). **Phase 15-B is not complete, and Phase 15 is
not complete.**

## Phase 15-B/2 — estimated spend aggregation and guard wiring (code-only)

15-B/1 built a decision model nothing called. This slice supplies the missing
production observation path:

```
generation_attempts  ->  readAttemptVolumes()        (the only DB touch)
                     ->  observeProviderCost()       (15-B/1 contract)
                     ->  aggregateCost()             (window total)
                     ->  resolveApplicableBudgets()  (strictest wins)
                     ->  evaluateResolvedCostGuard() (decision + recommendation)
                     ->  raiseAlert()                (13-D)
```

`src/lib/finops/estimated-spend-repository.ts` reads; `spend-guard-runner.ts`
is pure; `runEstimatedSpendGuard` in
`src/trigger/operational/operational-services.ts` is the real production
caller, surfaced as `estimatedSpendGuardTask` — a plain `task()`, **no
schedule**, like every other operational task there.

### Volume is counted in ATTEMPTS, and the query is three columns wide

A generation that failed twice and succeeded on the third try called the
provider three times. Counting generations would under-report it by exactly the
retries, which are the traffic most likely to blow a budget.

Only attempts that reached a provider count: `submitting`, `submitted`,
`processing`, `succeeded`, `failed`. `pending` and `claimed` are excluded —
those rows exist but the request never left Cinefield. `submitting` **is**
included, because an attempt stuck in flight is precisely the case where money
may have been spent with nothing to show for it.

The select list is `provider, provider_model, status`. No attempt id, no
generation id, no user id, no error text — and the `generations` table, which
holds the prompt, is never read at all.

### `per_output` models cannot be priced from current data, and say so

`per_request` maps cleanly: one attempt is one request, N attempts are N units.
That is a fact about the schema.

`per_output` needs an output count, and no such evidence exists. `generations`
has no quantity column, and while `media_assets` has a `provider_output` value
in its `source` CHECK constraint, **nothing writes one** — the only insert path
in the repository is the browser-upload route. Counting it would return zero
outputs for generated content: not a missing number but a wrong one, pricing
real traffic at nothing.

So `billableUnitsFor` returns null for `per_output`, which becomes UNKNOWN and
withholds ALLOW. Seeded pricing is four `per_output` rows to two `per_request`,
so **most image traffic is currently unpriceable**. That is the honest state of
the evidence; the fix is to record output counts, not to assume one output per
request so the arithmetic completes. `unpriceableLines` is in the task metrics
so the gap is visible rather than inferred, and a window with any unpriceable
line reports `partial`, never `success`.

### Four ways the window can lie, all closed

| condition | result |
| --- | --- |
| query returned rows | priced normally |
| query succeeded, zero rows | `sourceAvailable: true`, a real zero, ALLOW |
| query errored or threw | `sourceAvailable: false` -> UNAVAILABLE -> UNKNOWN |
| row count exceeded the scan cap | `sourceAvailable: false` — a truncated count is smaller than the truth, so reporting it would understate spend |
| a row missing provider or model | whole window unattributable, never silently dropped from the total |

**An unreadable window is decided before the budgets are consulted.** It has no
lines, so the representative observation carries no provider — and
`budgetApplies` would then match no provider-scoped budget, the resolver would
correctly answer "no applicable budget", and that reports as ALLOW. The window
is not unbudgeted, it is *unread*, and the two must never produce the same
verdict. This was a real fail-open found by the test matrix during
implementation; it is closed by short-circuiting in `runSpendGuard` rather than
by teaching the resolver about missing evidence.

### Two telemetry contracts, deliberately not conflated

`costTelemetryFields` is the 13-E surface — what reaches a log line through the
13-D alert, and it passes with nothing dropped. `spendGuardMetrics` feeds
`OperationalTaskResult.metrics`, a return value rather than a log; every
operational service here returns counts under its own names (`models`,
`unpriced`, `ambiguousAttempts`), none allow-listed and none logged. Its
obligation is the operational contract's: counts only, never content, and no
window bound — a timestamp would make every pass its own metric series.

### Still an estimate, and still nothing is mutated

Attempt counts times a price list is a forecast. `basis` remains
`ESTIMATE_BASED` on every result. This slice writes no `cost_amount`, sets no
routing control, spends no credits, calls no provider and creates no schedule —
all enforced by test, against comment-stripped source, so a file that documents
the rule it obeys is not read as breaking it.

### Not in this slice

Real budget limits (the registry is still deliberately empty, so a pass today
resolves to `no_applicable_budget`); output-count evidence; the pre-spend gate
in front of `executeGeneration`; actually setting a routing control; cadence;
Stripe / AWS / invoice correlation; UI. **Phase 15-B is not complete, and Phase
15 is not complete.**

## Phase 15-B/3 — spend accounting correction and production proof

Four findings from the 15-B/2 post-implementation audit, all closed.

### F1 — `cancelled` attempts could hide real spend (fail-open)

`markAttemptTerminal` may only close an ACTIVE attempt, and that set includes
`submitted` and `processing`. An attempt that **already reached the provider**
can therefore be cancelled afterwards, and the provider may already have
charged for it. Excluding every `cancelled` row under-reported spend, making
the guard more permissive than reality.

Counting every `cancelled` row is wrong in the other direction: one cancelled
while still `pending` never left Cinefield and cost nothing.

`submission_evidence` is the canonical discriminator and already existed:

| status | evidence | counted | why |
| --- | --- | --- | --- |
| `pending` | any | NO | the request never left Cinefield |
| `claimed` | any | NO | claimed for submission, not yet sent |
| `submitting` | any | YES | in flight; money may already be spent |
| `submitted` | any | YES | a provider job exists |
| `processing` | any | YES | the provider is working on it |
| `succeeded` | any | YES | completed and billable |
| `failed` | any | YES | a failed provider call is still a call |
| `cancelled` | `none` | NO | provably never crossed the boundary |
| `cancelled` | `ambiguous` | **YES** | cannot prove it did not leave |
| `cancelled` | `job` | **YES** | a provider job id exists |

**AMBIGUOUS COUNTS.** "AMBIGUOUS is not SAFE" is a standing rule in this
codebase; applied to money it means an attempt we cannot prove was free is
treated as paid. Guessing the cheaper answer would be guessing in the
provider's favour with Cinefield's budget.

The rule lives in one exported function, `countsAsSpend`, pinned directly by a
test table that also asserts every status in the schema CHECK appears in it —
so a new status cannot be added without a recorded accounting decision.
`cancelled` rows are **fetched** and then judged; filtering them out in SQL
would make the rule unenforceable because the rows needing judgement would
never arrive.

### F2 — the production path is now behaviourally tested

15-B/2 shipped with only a source-regex assertion that
`runEstimatedSpendGuard` existed. That proves a declaration, not behaviour: the
registry join, the pricing pre-fetch, window resolution and the
`unavailable`/`no_work`/`partial`/`success` mapping were all unexecuted.

Twelve behavioural tests now run the real entry point through the same injected
`OperationalDeps` seam the other seven operational services use — covering
unconfigured admin, invalid windows, empty windows, query failure, priced
success, evidence-based cancelled accounting, window boundary exclusion,
unpriced models (`partial`), pricing-read failure, routed traffic, and a proof
that the pass performs no RPC and no delete.

### F3 — NUL byte removed

`estimated-spend-repository.ts` contained a literal NUL used as a Map-key
separator, which made git classify the file as binary and hid it from
`git show`. It is replaced by a **nested map** (`provider -> providerModelId ->
count`) rather than another separator character: any separator is a character
a provider id or model id could legitimately contain, which is a silent
collision between two models' spend. Nesting removes the question instead of
answering it.

A test walks `src/lib` and `src/trigger` and fails on any NUL in a `.ts`/`.tsx`
file. (One deliberate NUL remains in
`src/test/e2e/phase-12e-policy-gate.e2e.test.ts`, where Phase 12-E injects it
into an action name to prove the policy gate rejects it — a fixture, not a
defect, and outside the walked directories.)

### F4 — routed traffic now prices, through the canonical join

An attempt records `routing?.providerId ?? model.providerId`, so a Phase 7
route override writes the ROUTE's identity, which need not appear in the static
`model-registry.ts` catalogue. Those pairs priced as UNKNOWN — safe, but
systematically unpriceable for exactly the traffic an operator redirected.

The mapping already exists in tables Phase 7 owns:

```
generation_attempts(provider, provider_model)
  -> provider_models(provider_id, provider_model_id)   [UNIQUE together]
  -> model_routes(provider_model_id) -> model_id       [= platform model id]
  -> model_pricing(platform_model_id)
```

The catalogue is still consulted first; the join runs only for pairs it missed.
**Ambiguity is reported, not resolved:** `model_routes` is unique on
(model_version_id, provider_model_id), not on provider_model_id alone, so one
provider model may be reachable from several platform models. When the join
yields more than one distinct `model_id` the pair stays UNRESOLVED — two
platform models can carry different prices, and choosing one would be
fabricating a price behind the appearance of a lookup. A failed join is
`sourceAvailable: false`, never "nothing matched".

No fallback to `credit_price_per_unit`, no default price, no other provider's
price — asserted structurally.

### Still deferred, still honest

`per_output` remains unpriceable (no output-count evidence). `COST_BUDGETS`
remains empty: **REAL_BUDGET_LIMIT_ACTIVE = NO**, and the first real limit is a
business decision, not something an agent may invent. When it is made, it
belongs in a dedicated server-side FinOps budget configuration with GLOBAL /
PROVIDER / PROVIDER_MODEL scopes — not scattered across source files. No
`cost_amount` write, no routing mutation, no migration, no UI.

## Phase 15-C/1 — restore verification contract and validation engine (code-only)

Roadmap 15-C: PostgreSQL PITR, R2→S3 backup, restore verification, checksum,
row-count, referential integrity, isolated staging restore. Done criterion:
*"an isolated restore can be verified rather than merely assuming backups
exist."* This batch delivers the verification ENGINE and its CONTRACT; it
does not perform a live restore, and it does not close Phase 15-C.

`src/lib/dr/` — `restore-evidence-contract.ts`, `restore-canonical-digest.ts`,
`restore-isolation-guard.ts`, `restore-target.ts`,
`restore-row-count-validator.ts`, `restore-checksum-validator.ts`,
`restore-referential-integrity-validator.ts`, `restore-verification-engine.ts`,
`dr-alert-bridge.ts`. All pure except the isolation-guard's environment check
and the engine's orchestration of an injected source — no database driver, no
AWS SDK, no Docker anywhere in the package.

### The principle this package exists to enforce

    BACKUP_EXISTS   != RESTORE_SUCCEEDED
    RESTORE_STARTED != RESTORE_VALIDATED

A backup existing (Phase 9-D's `backup_status = 'backed_up'`) proves bytes
were written to S3 and S3 answered a HeadObject. It proves nothing about
whether a PITR snapshot would reconstitute a working Cinefield. Only a
validated restore does, and `VALIDATION_PASSED` is reachable in exactly one
way: every check that ran agreed. Nothing upgrades to it by omission —
missing evidence is `UNAVAILABLE`, never a silent pass.

### Five states, and what each one costs to reach

    NOT_CONFIGURED    no restore target wired up at all — not a failure
    UNAVAILABLE       a read failed, or the environment was refused
    RESTORE_NOT_READY the target answered, but the restore has not finished
    VALIDATION_FAILED a check PROVED a mismatch
    VALIDATION_PASSED every check that ran agreed

The engine's call order is the safety property: no source is configured →
stop. Environment declared unsafe → stop, **before a single read** — a
target declared "production" or "unknown" never has `isRestoreReady()`
called on it, let alone a row-count or checksum read. Not ready → stop. Only
then do row-count, checksum, and referential-integrity validation run, in
parallel, over the same injected source.

### Environment identity is declared, never inferred

`RestoreEnvironmentClass` is one of isolated_throwaway, isolated_staging,
production, or unknown. `assertRestoreSafeEnvironment` reads a value the
CALLER asserted; it does not read `NODE_ENV`, does not parse a hostname,
does not guess. Unknown is refused exactly like production — there is no
default, because a default is exactly how a validator ends up treating an
unrecognised target as safe ("the hostname didn't look like production, so
it must be fine"). A malformed label (long, or shaped like a connection
string) is refused the same way.

### Row-count validation: a written allow-list, not every table

`DURABLE_TABLES` names sixteen tables and WHY each is restore-significant:
`generations`, `generation_attempts`, `profiles`, `projects`,
`credit_wallets`, `credit_ledger`, `media_assets`, `models`, `providers`,
`provider_models`, `model_versions`, `model_pricing`, `plan_limits`,
`security_events`, `media_safety_audit`, `media_release_approvals`.

Excluded on purpose: `outbox_events` and `workflow_start_outbox`, whose own
migrations state rows "may still be deleted by a future retention/archival
job" and document an entire migration retiring abandoned rows
(`20260818010000_retire_historical_start_intents.sql`) — comparing their
counts across a restore would flag healthy purging as corruption.
`outbox_tx_proof` and `credit_reservations` are the same shape: transient
claim/lease state.

Overall outcome: a proven MISMATCH outranks UNAVAILABLE, which outranks
MATCH — a known problem in one table is reported even when another table's
read failed, but an unreadable table can never be silently treated as
agreeing. MATCH requires every expected table to have been read AND to have
agreed.

### Checksum validation reuses `checksum_sha256`, computes no new digest over media

The Phase 9-B ingest gate's own content-identity column (64 lowercase hex,
CHECK-enforced) is the digest compared — this package does not hash media
bytes itself. `restore-canonical-digest.ts` uses plain `node:crypto`, not
the Phase 9-B sandboxed inspector: the sandbox exists because media bytes
are UNTRUSTED external input; a row-count manifest is the process's own
structured data and needs no isolation, only a stable serialization (sorted
by table name, no timestamp, no restoreId — a capture time is real
information but not part of the DATA being verified, and including it would
make two identical restores of the same backup produce different digests
depending on when validation happened to run).

### Referential integrity: PostgreSQL is the authority, this package reads its verdict

No relationship graph exists in TypeScript. `ConstraintHealthEvidence` names
constraints Postgres itself marked NOT VALID
(`pg_constraint.convalidated = false`); the validator reports that verdict,
it does not compute one. Re-encoding "media_assets references generations"
as a second, hand-maintained fact in application code would drift the
moment a migration changed the real one.

### The restore target is an interface, not an adapter

`RestoreEvidenceSource` has four read-only methods (`isRestoreReady`,
`getActualRowCount`, `getActualChecksum`, `getConstraintHealth`) and nothing
else — no `restore()`, no `mutate()`. No concrete implementation ships in
this batch: `deps.getRestoreEvidenceSource` defaults to `() => null`, so an
unmodified deployment honestly reports NOT_CONFIGURED, the same shape the
previous stub reported but now because nothing is wired up rather than
because nothing was written. The existing
`supabase/tests/run_pg_tests.sh` throwaway-Docker harness is the natural
first adapter for a later slice; it is not built here.

### `runRestoreVerification`: real logic, still honest by default

Reads "expected" row counts and a bounded checksum sample from the
CANONICAL database — read-only, the same `count: "exact", head: true` shape
`countBackupDebt` already uses, and the same eligibility Phase 9-D already
enforces (`backup_status = 'backed_up'` implies `ingest_status = 'verified'`
implies a non-null `checksum_sha256`). `restoreVerificationTask` remains a
plain `task()`, no schedule — production cadence stays undefined, the same
reasoning `providerCostReconcileTask` and `estimatedSpendGuardTask` already
state.

### Alerting: one new type, only on a proven failure

`dr_restore_validation_failed` (source `dr`, severity ERROR,
`userVisible: false`, `remediationEligible: false`) is raised through the
existing 13-D router by `dr-alert-bridge.ts`. NOT_CONFIGURED, UNAVAILABLE
and RESTORE_NOT_READY all raise nothing — the alert catalogue's own note on
DR backup debt already states the rule this follows: "an alert type for a
subsystem that cannot report is a fake alert." A positively-known
VALIDATION_PASSED resolves a standing failure; every other state changes
nothing.

### Ownership preserved

Phase 9-D's backup/write path (`dr-backup-client.ts`, `dr-backup-service.ts`)
is unmodified and unduplicated — this package only reads what it already
recorded. Phase 7 routing, Phase 10 credit ledger, Phase 13-D alert routing,
Phase 13-E telemetry boundary, and Phase 21 generic feature flags are all
untouched (verified structurally: zero occurrences of Temporal, SQS,
provider-execution, credit-mutation, or scheduling calls anywhere in
`src/lib/dr/`). `OperationalTaskResult.metrics` remains a return-value
contract, not a telemetry emission point — the same precedent Phase 15-B's
`spendGuardMetrics` established.

### Not in this slice

Live PostgreSQL PITR (DEFERRED_EXTERNAL — requires Supabase plan/dashboard
configuration this repository cannot reach); a real `RestoreEvidenceSource`
adapter; the S3→R2 restore-back contract (defined in
`CINEFIELD_ARCHITECTURE_CONTRACT.md`, not implemented); a restore-evidence
persistence table (bounded in-memory/task-result evidence is sufficient
today); any Trigger.dev schedule; any UI (Phase 16 will surface last-restore
age, checksum/row-count/integrity summaries, and RPO/RTO status). Phase 26/28
own cross-region failover, chaos testing, and enterprise DR — nothing here
claims any of that. **Phase 15-C is not complete.**

## Phase 15-C/2 — real local pg_dump/pg_restore round trip

15-C/1 proved the validation ENGINE was correct against synthetic fixtures.
It could not prove a RESTORE was correct, because nothing had ever actually
been restored. This batch closes that gap locally: `migration replay`
(what `run_pg_tests.sh` has always done — rebuild a database FROM
MIGRATIONS) and `backup restore` (take a REAL `pg_dump` of a populated
database, `pg_restore` it into a SEPARATE database, and validate the copy)
are different claims, and only the second is what "isolated restore
doğrulanıyor" actually means.

`supabase/tests/run_pg_restore_proof.sh` — Docker-required, manually
invoked, exactly like `run_pg_tests.sh` — performs the real round trip:

```
SOURCE throwaway Postgres
  -> apply_all_migrations() (shared with run_pg_tests.sh)
  -> fixtures_restore_proof.sql (real functions: create_generation_tx,
     reserve_credits, settle_reservation, record_media_ingest,
     finalize_media_asset, record_media_backup, record_security_event)
  -> capture EXPECTED evidence (row counts + checksum), read from the
     SOURCE, before anything is dumped
  -> pg_dump -Fc --no-privileges --no-owner
  -> source container destroyed
  -> TARGET throwaway Postgres (a SEPARATE container)
  -> pg_restore
  -> RestoreEvidenceSource (createThrowawayPostgresSource) reads ACTUAL
     evidence from the TARGET only
  -> runRestoreValidation (the same production validation core
     runRestoreVerification delegates to)
  -> teardown, on success or failure
```

### The harness drift this batch fixed first

An earlier audit found `run_pg_tests.sh` had fallen one migration behind:
`20260828000000_rls_grant_hardening.sql` was never added to its hard-coded
per-line file list. `supabase/tests/lib_pg_migrations.sh` is now the ONE
place both harnesses get their migration list from, and it does not hold a
list at all — it globs `supabase/migrations/*.sql` (excluding only
`20260805132704_remote_schema.sql`, which `bootstrap_test_schema.sql`
substitutes for, by design). A new migration is picked up the moment the
file exists; there is no list to remember to update, which is what made the
original drift possible.

Found and fixed while building this: the glob must be NUL-delimited
(`find ... -print0` / `read -r -d ''`), not `for f in $(find ...)` — this
repository's own path contains a space ("Wep sitem"), and unquoted command
substitution word-splits on it, corrupting every filename after the first
space. That is the exact bug class a naive glob-to-list conversion would
have reintroduced.

### `--no-privileges` — a scope boundary, not a shortcut

`pg_dump`'s `GRANT` statements target `anon`/`authenticated`/`service_role`,
cluster-wide roles a plain `pg_dump` of one database never carries — a fresh
target container has none of them, so a restored `GRANT` to a role that does
not exist fails the restore outright. Row-count, checksum and
referential-integrity evidence do not depend on grants, and
`bootstrap_test_schema.sql`'s own header already states no proof in this
harness makes a claim about RLS/privilege behaviour — excluding privileges
from the dump gives up nothing this batch verifies. `CREATE POLICY`
statements are a SEPARATE `pg_dump` object class `--no-privileges` does not
touch, so the target still gets the same three placeholder roles
`bootstrap_test_schema.sql` creates on the source, created fresh before
`pg_restore` runs.

### Expected vs. actual: physically separate code paths

`scripts/dr-restore-proof-capture-expected.ts` runs BEFORE `pg_dump`,
against the SOURCE only, and does not trust the fixture script's own printed
identifiers — it queries `media_assets.checksum_sha256` back out of the
database rather than assuming an insert did what it was supposed to.
`scripts/dr-restore-proof-verify.ts` runs AFTER `pg_restore`, and its
`RestoreEvidenceSource` (`createThrowawayPostgresSource`) has no field,
parameter, or closure capable of holding a source-side value — every method
issues a fresh query against the TARGET via an injected `exec` function.
There is no `matches: boolean` shortcut anywhere in the interface for an
adapter to exploit.

This was proven, not just asserted: the real round trip mutates the
RESTORED target's `checksum_sha256` after `pg_restore` completes and reruns
validation. The adapter reported the mutated value (`actualDigest:
"ffff…"`), not the source's original — proof the digest is re-read from the
restored state, not echoed.

### Real, Docker-executed proofs — the actual results

One golden round trip, then three isolated, sequential corruptions on the
TARGET only, in the order referential-integrity → checksum → row-count, so
each corruption's `reasonCode` is unambiguous at the moment it is
introduced (the engine's own priority — MISMATCH beats UNAVAILABLE beats
MATCH, row-count checked before checksum before referential integrity —
means a later corruption's reason masks an earlier one, which is expected
and itself confirms the priority ordering documented in 15-C/1):

| proof | state | reasonCode |
| --- | --- | --- |
| golden round trip | VALIDATION_PASSED | restore_validation_passed |
| `ADD CONSTRAINT ... NOT VALID` on the target | VALIDATION_FAILED | referential_integrity_invalid |
| `UPDATE media_assets SET checksum_sha256 = ...` on the target | VALIDATION_FAILED | checksum_mismatch |
| `DELETE FROM generation_attempts` on the target | VALIDATION_FAILED | row_count_mismatch |
| target pointed at a nonexistent database | RESTORE_NOT_READY | restore_not_ready |

All sixteen `DURABLE_TABLES` were read from both sides; the golden run's
expected and actual row-count manifest digests were byte-identical. Cleanup
(both containers, the temp dump file, the temp expected-evidence JSON) was
verified on success and, separately, by deliberately injecting a failure
mid-run — the `trap cleanup EXIT` fired in both cases.

### What this does, and does not, prove

`LOCAL_REAL_POSTGRES_BACKUP_RESTORE_ROUNDTRIP` — a real `pg_dump`/`pg_restore`
cycle between two disposable, local, non-production Postgres containers,
validated by the same engine production code calls. It does NOT prove Supabase
PITR: live PITR requires Supabase plan/dashboard configuration this repository
cannot reach, remains **DEFERRED_EXTERNAL**, and nothing here is renamed to
imply otherwise. S3→R2 restore-back stays a defined, unimplemented contract
(Phase 9-D ownership, untouched). Production restore cadence remains
undefined — `restoreVerificationTask` is still a plain `task()`, no
`schedules.task()` anywhere.

## Phase 15-D/1 — DLQ redrive decision engine + evidence contract (code-only)

Roadmap 15-D: DLQ redrive / RTO-RPO / region outage / recovery game-day. This
batch is the first slice: a deterministic, fail-closed decision of whether one
message parked in `cinefield-provider-dlq.fifo` (Phase 6R.4's real,
production-provisioned topology; see `docs/operations/AWS_PROVIDER_RUNTIME.md`)
is safe to move back onto `cinefield-provider.fifo` — never whether it would
succeed. `src/lib/aws/dlq-redrive/` does not call AWS. It does not redrive a
real message. It does not add a second DLQ, a second CloudWatch alarm, or a
second SNS topic — `cinefield-provider-dlq-messages` already alarms on depth,
and this batch does not touch it.

### Scope: the provider queue only

Six of `sqs-topology.ts`'s seven queues have no wire-format schema, and per
that file's own comment several have no consumer at all yet. A redrive
decision for a message shape that does not exist would mean inventing one.
This engine decides `cinefield-provider.fifo` / `cinefield-provider-dlq.fifo`
only — the one queue with a real wire contract (`command-wire.ts`) and a real
safety story (the B3 atomic claim). The other queues' redrive decisions are
future work, once each has a consumer and a wire format to validate against.

### What `SAFE_TO_REDRIVE` means, precisely

It is a SAFETY proof, not a SUCCESS prediction. It means the durable evidence
proves no submission was ever attempted for this attempt
(`status = 'pending'`, `submission_evidence = 'none'`) and the generation can
still legally accept one (`status` in `queued`/`processing`) — so a redrive
cannot cause a double submission, cannot bypass `claimAttemptForSubmission`
(the B3 gate, unchanged, untouched), and cannot fabricate provider or billing
evidence. The real worker (`provider-command-handler.ts`) still re-runs its
own full re-validation — model registry, provider registry, generation
state — the moment a redriven message actually arrives, exactly as it does
for every other delivery; a message this engine calls safe can still be
safely retained again if that re-check disagrees. A real redrive call itself
is not built in this batch — see "Not in this slice".

### Six states, one positive path

`SAFE_TO_REDRIVE`, `REFUSE_AMBIGUOUS_PROVIDER_STATE`,
`REFUSE_TERMINAL_GENERATION`, `REFUSE_INSUFFICIENT_EVIDENCE`,
`REFUSE_INVALID_MESSAGE`, `UNAVAILABLE`. `SAFE_TO_REDRIVE` is reachable
through exactly one branch in `dlq-redrive-decision-engine.ts` — pending
attempt, no submission evidence, submittable generation — and every other
combination, including any status the closed `GenerationAttemptStatus` union
does not yet name, refuses rather than falls through. A pinned array
(`DLQ_REDRIVE_DECISION_STATES`) and a `REDRIVE_PERMITTED_STATES` set of
exactly one member are both tested directly, so a future status added to the
union without a corresponding branch fails loudly instead of silently
inheriting safe behaviour.

### Reused, not re-derived

The evidence source (`DlqRedriveEvidenceSource`, modelled directly on Phase
15-C/1's `RestoreEvidenceSource`) is a two-method, read-only interface. The
real adapter (`createSupabaseDlqRedriveSource`) reads attempt truth through
`readAttempt` — the SAME function `provider-command-handler.ts` and
`attempt-submission-service.ts` already trust — and reads the generation
through a `select("status")` query narrower than any other generation read in
the codebase, so there is nothing for a future edit to accidentally leak into
evidence. `CommandClassification` (safe/ambiguous/retryable/non_retryable) is
a different question asked from inside the worker mid-delivery; this engine
answers a later, outside question from the same underlying evidence, and does
not claim the two classifications are the same thing. A structural test
cross-checks this engine's terminal/submittable literals against
`provider-command-handler.ts`'s own source text so the two vocabularies
cannot silently diverge.

### Structural safety, not just inspection

A test scans every file in `src/lib/aws/dlq-redrive/` (comments stripped) for
`submitAttempt(`, `executeGeneration(`, credit/reservation identifiers,
`cost_amount`/`cost_currency`, `credit_ledger`/`credit_wallets`, any attempt
claim mutator, `StartMessageMoveTask`/`@aws-sdk`/`new SQSClient`, and any
`.insert(`/`.update(`/`.upsert(`/`.delete(` call — none exist anywhere in the
package. A second test asserts the adapter's only `select()` call is
literally `"status"`. A third asserts no sensitive field name (prompt,
`input_url`, `output_url`, `apiKey`, `signedUrl`, `authorization`, …) appears
anywhere in the package's source.

### Phase 13-D — deliberately not touched

`ALERT_CATALOGUE`'s own standing rule (Phase 15-C/1 already states it) is
that a type with no real producer is a fake alert. Nothing in this batch
schedules or polls, so there is no live caller that could raise a new alert
from a proven `REFUSE_*`/`UNAVAILABLE` outcome — adding one now would be
exactly that fake-alert shape. DLQ depth already alerts today through the
existing, external CloudWatch `cinefield-provider-dlq-messages` alarm and its
SNS subscription (`AWS_PROVIDER_RUNTIME.md`); this batch does not duplicate
it and does not fake a correlation with it.

### Not in this slice

Any real AWS redrive call (`StartMessageMoveTask` or otherwise); any
scheduled/automatic invoker (`evaluateProviderDlqMessage` is a real,
production-shaped function with no live caller yet, the same shape
`runRestoreVerification` had before anything scheduled called it); a new
Phase 13-D alert type; RTO/RPO numeric targets (still
`UNDEFINED_BUSINESS_DECISION`, per the Phase 15-D master audit); a region
outage runbook; any chaos/game-day infrastructure; any UI; any migration.
**Phase 15-D is not complete.**

## Phase 15-D/2 — recovery contract, RTO/RPO model, deterministic measurement (code-only)

`src/lib/recovery/` classifies whether a real recovery met its (possibly
nonexistent) time and data-loss commitments. It does not detect incidents, does
not execute a redrive, does not run chaos, and does not touch AWS, a provider,
or money — every method in the package is pure arithmetic over caller-supplied
evidence.

### No RTO/RPO numbers invented; the registries ship empty

`RTO_TARGETS` and `RPO_TARGETS` (`recovery-target-registry.ts`) are both `{}`.
Setting a recovery-time or data-loss commitment is a business decision no
approval for exists in this repository, exactly as the Phase 15-D master audit
established. `resolveRtoTargetMs`/`resolveRpoTargetSeconds` return `null` for
anything not explicitly and validly configured — never a fabricated number,
never zero.

### NO_TARGET != MET

`RECOVERED_NO_TARGET` is its own state in the six-member
`RecoveryResultState` union, precisely so an empty registry can never be read
as "everything met its target." `rtoMet`/`rpoMet` are `undefined`, never
`true`, when no target resolves; a test (`RTO_TARGETS`/`RPO_TARGETS` asserted
`{}` directly, and `resolveRtoTargetMs`/`resolveRpoTargetSeconds` asserted
`null`) pins this so populating either registry later cannot silently change
the meaning of "no target."

### Deterministic measurement — `now` is always an input

`measureRecovery` never calls `Date.now()` or `new Date()` internally; the
evaluation instant is a required parameter, so the same input always produces
byte-identical output. Timestamps are validated in order — unparseable, then
out-of-chronological-order, then a malformed (`NaN`/negative/`Infinity`)
data-loss observation — before any duration is computed, so a negative or
fabricated duration is structurally impossible rather than merely unlikely.
`RECOVERY_INCOMPLETE` covers both "not yet restored" and "restored but
required validation did not pass"; `EVIDENCE_UNAVAILABLE` is reserved for
required evidence that could not be OBTAINED at all — the same
known-negative-fact-vs-missing-fact distinction `dlq-redrive-decision-engine.ts`
already draws between `REFUSE_INSUFFICIENT_EVIDENCE` and `UNAVAILABLE`. A
proven breach on either the RTO or the RPO axis always wins over a met target
on the other — `RECOVERED_OUTSIDE_TARGET` is never hidden behind a "within
target" headline, the same ordering discipline `runRestoreValidation`'s
MISMATCH-beats-UNAVAILABLE-beats-MATCH already established.

### Ownership boundaries preserved, not re-derived

Health truth remains Phase 13: `recovery-health-bridge.ts`'s
`isRuntimeConsideredRecovered` is a one-line predicate over an
already-obtained `ReadinessReport` (`status === "HEALTHY"`, DEGRADED is
deliberately NOT recovered) — it does not track transitions, does not poll,
and does not redefine `HealthStatus`. Restore truth remains Phase 15-C: for
`database_recovery`/`media_recovery` (`CLASSES_REQUIRING_RESTORE_VALIDATION`),
the engine consumes an already-computed `RestoreValidationState` and gates on
it being exactly `VALIDATION_PASSED` — it does not recompute checksum,
row-count, or referential-integrity logic, proven by a structural test that
the package never mentions `checksum_sha256`/`pg_constraint`/`convalidated`.
Rollback authority remains Phase 14-D: nothing here evaluates deployment
eligibility or proposes a rollback; a bad-release decision and a
recovery-time measurement stay two separate questions with two separate
files. AWS redrive execution and chaos/game-day infrastructure both remain
exactly as deferred as Phase 15-D/1 left them — this batch adds no new AWS
call and no failure-injection of any kind.

### 13-D integration — only a proven breach or proven missing evidence alerts

Three new catalogued types (`recovery_rto_breached`, `recovery_rpo_breached`,
`recovery_evidence_unavailable`; source `"recovery"`, all `ERROR`, none
user-visible) with a real producer, `recovery-alert-bridge.ts`, registered in
the S13D-27 catalogue-coverage scan alongside `dr-alert-bridge.ts` and
`cost-alert-bridge.ts`. `RECOVERED_NO_TARGET`, `RECOVERY_INCOMPLETE`, and
`INVALID_EVIDENCE` all raise nothing — an absent business-approved target, an
in-progress recovery, and a caller bug are not incidents. All three new
alert types are `remediationEligible: false` in Phase 14-D's own
`incident-diagnosis.ts` eligibility table: an infrastructure recovery-time or
data-loss breach has no source-code fix, the same reasoning already applied
to `dr_restore_validation_failed`.

### Not in this slice

Any incident detection (nothing populates a `RecoveryIncidentEvidence` from a
live signal yet); a live wiring from `isRuntimeConsideredRecovered` to a
`serviceRestoredAt` stamp; a region-outage runbook; RTO/RPO numeric targets
(still `UNDEFINED_BUSINESS_DECISION`); any chaos/game-day infrastructure; any
UI; any migration (`RecoveryIncidentEvidence` has no persistence — no
recovery-history table was created). **Phase 15-D is not complete.**

## Phase 15-D/3 — manual DLQ investigation entrypoint (code-only)

A read-only, operator-invoked path that peeks at most one message from the
real `cinefield-provider-dlq.fifo`, evaluates it through the UNMODIFIED
Phase 15-D/1 decision engine, and returns a bounded verdict. It never
redrives, deletes, or mutates anything.

### SAFE_TO_REDRIVE is authorization evidence, not execution

This batch adds a real, read-only AWS SQS adapter
(`src/lib/aws/dlq-redrive/adapters/sqs-dlq-message-source.ts`) to the same
package Phase 15-D/1 built — the FIRST real AWS integration point in the
package — but its only method is a peek: `ReceiveMessageCommand` with
`VisibilityTimeout: 0`, so the message is immediately visible again to any
other reader the instant the call returns. There is no visibility window
opened here to later restore, because none is ever opened. No
`DeleteMessageCommand`, `ChangeMessageVisibilityCommand`,
`StartMessageMoveTaskCommand`, `SendMessageCommand`, `PurgeQueueCommand` or
`SetQueueAttributes` import exists anywhere in the file — an investigation
cannot mutate the queue, structurally, because the SDK command needed to do
so is never imported. Real AWS redrive execution remains exactly as
unimplemented as Phase 15-D/1 left it.

### Phase 15-D/1 remains sole decision authority

`dlq-investigation-service.ts`'s `investigateProviderDlq` calls
`evaluateDlqRedriveDecision` — the SAME pure engine `evaluateProviderDlqMessage`
already calls in production — and passes its verdict through verbatim. A
structural test asserts the literals `"SAFE_TO_REDRIVE"`/`"REFUSE_..."`
appear nowhere in the investigation service outside that one import, so a
future edit cannot quietly grow a second, competing classification. Four
outcomes only: `NOT_CONFIGURED` (no DLQ source wired), `SOURCE_UNAVAILABLE`
(the queue could not be read), `NO_MESSAGE` (the DLQ is empty right now —
ordinary, not an error), and `DECIDED` (the engine's own six-state verdict).

### Entrypoint shape: a manual script, not a route

`scripts/dlq-investigate.ts` — run as `npx tsx scripts/dlq-investigate.ts`,
the same manual-invocation shape `scripts/dr-restore-proof-verify.ts`
(Phase 15-C/2) already uses. No HTTP route, no scheduler, no cron, no
polling loop — a structural test confirms no file under `src/app/api/`
references any part of this path. The AWS and Supabase service-role
credentials the script already requires to do anything at all ARE the
access control; no new admin-auth system was built. Deliberately does not
call `assertStartupConfiguration` — that gate exists to refuse an invalid
PRODUCTION RUNTIME at process start for a long-lived worker, and forcing it
here could make a narrow investigation tool refuse to run during exactly
the messy-production-config moment it exists to help diagnose.

### New configuration, registered

`CINEFIELD_SQS_PROVIDER_DLQ_URL` (optional, identifier-class, not a secret —
authority is IAM, same as the existing provider queue URL) is registered in
`secret-registry.ts` and documented in `.env.example`; an unmodified
deployment leaves it unset and `createSqsDlqMessageSource()` returns `null`,
so the investigation path honestly reports `NOT_CONFIGURED` rather than
guessing a URL.

### RTO equality boundary — pinned, not redesigned

The Phase 15-D/2 post-implementation audit found one minor test-coverage
gap: `recoveryDurationMs == targetRtoMs` was never directly asserted, though
the production comparison (`<=`) already treats equality as met. A single
regression test was added to `phase-15d2-recovery-rto-rpo.e2e.test.ts`
pinning that exact convention; no production arithmetic changed, because
none needed to.

### Not in this slice

Real AWS redrive execution (`StartMessageMoveTask` or otherwise); any
scheduled/automatic invocation of the investigation path; RTO/RPO numeric
targets (still `UNDEFINED_BUSINESS_DECISION`); a region-outage runbook; any
chaos/game-day infrastructure; any UI; any migration. **Phase 15-D is not
complete.**

## Phase 16/1 — read-only Admin Operations Center + System Health (code-only)

The first Phase 16 vertical slice: an authorization boundary, a protected
health read, and a `/admin` shell showing System Health — reusing Phase 13
health truth verbatim, nothing else.

### "apps/admin" reconciled to repository reality

The roadmap phrase names a separate `apps/admin` application. This repository
is a single Next.js app with no `apps/` directory, and this batch does not
create one — Phase 16 lives at `src/app/admin/` inside the existing app. A
structural test asserts no `apps/` directory exists after this batch. If a
true monorepo split is ever wanted, that is its own deliberate, separately
reviewed decision — not a side effect of building one health screen.

### Admin authorization — bootstrap, deny-by-default, one canonical boundary

`decideAdminAccess()` (`src/lib/admin/admin-auth.ts`) is the ONE decision
core both `/admin`'s layout and `/api/admin/health` call, via the thin I/O
wrapper `requireAdminAccess()` (`require-admin-access.ts`). No session -> deny.
Session but not on the allowlist -> deny. The allowlist source itself
unreadable -> deny. There is no branch, in either file, that resolves to
`allowed: true` without both a real Clerk session and an explicit match.

`CINEFIELD_ADMIN_CLERK_USER_IDS` is a bootstrap allowlist — the same shape
`admin-route-service.ts`'s `ROUTE_ADMIN_CLERK_USER_IDS` already uses for
Phase 7-B, but a SEPARATE variable: that older allowlist stays scoped to
route mutations, and is never silently promoted into the universal Phase 16
authority (a structural test asserts `admin-auth.ts` never references it).
This is explicitly a bootstrap, not the intended end state — the repository
has no admin role, no admin claim, and no org-based RBAC today. Splitting
`decideAdminAccess` (pure, testable) from `requireAdminAccess` (the one place
`@clerk/nextjs/server` is imported) means a future real role/claim system
replaces only `isBootstrapAdmin`'s internals; every caller stays untouched.

Both denial paths (no session, wrong session) return the SAME opaque 404 from
`/api/admin/health` — the same choice `admin-route-service.ts`'s
`assertRouteAdmin` already made, so a prober learns nothing about whether an
admin surface exists at this URL.

### Phase 13 remains health truth owner; Phase 16 is presentation only

`admin-health-service.ts`'s `collectAdminHealth()` calls Phase 13's own
`readiness()` once per `RuntimeName`, concurrently, and hands the results to
`projectAdminHealth()` (`admin-health-projection.ts`) — a pure reshape, never
a re-derivation. No `AdminHealthStatus`, no second `rollUp()`, no dependency
evaluated by this code — `HealthStatus`/`HealthReason`/`Criticality` are
imported from `health-contract.ts` unchanged. `UNKNOWN` stays `UNKNOWN`;
`UNREADY` can never roll up to `HEALTHY` — the severity ordering used to pick
`overallStatus` treats `UNREADY` as strictly the worst outcome.

`/api/health/live` is untouched — still anonymous, still minimal, still no
dependency detail. `/api/admin/health` is the opposite on every axis
(admin-only, dependency-level detail) precisely because that disclosure risk
is what `requireAdminAccess` exists to gate.

### Read-only, structurally proven

No file in `src/lib/admin/`, `src/app/admin/`, `src/app/api/admin/`, or
`src/components/admin/` can redrive a DLQ message, mutate a route, trip a
kill switch, release a quarantine, execute a restore, deploy, roll back,
submit a provider, or write to the database — proven by a structural scan for
each specific mutation identifier, not merely by inspection.
`admin-route-service.ts` (Phase 7-B) was inspected for authorization
precedent only; none of its mutations are wired into this UI.

### Not in this slice

Any operational action (DLQ redrive, route mutation, kill switch, quarantine
release, restore execution, deploy/rollback, billing mutation); real Clerk
org-role RBAC; alert/incident, cost, restore-evidence, recovery, or
route-admin screens (named in the shell's navigation as inactive labels
only); alert-history or recovery-incident persistence (both remain
unpersisted, exactly as the Phase 16 master audit found); addition to product
navigation. **Phase 16 is not complete.**

## Phase 16-A/2 — read-only generation investigation (code-only)

Answers one operator question: "what happened to this generation?" —
Generation summary, its attempts in order, and whatever trace/correlation
evidence was actually persisted. No operational action of any kind.

### The real trace chain, verified against schema — not the roadmap's guess

`generations` and `generation_attempts` have no `trace_id` column. The only
persisted trace correlation for a generation is `outbox_events` rows where
`aggregate_type = 'generation'` and `aggregate_id` is the generation id —
and `trace_id` there is nullable: `claim_generation_tx` writes
`p_trace_id: null` unconditionally, while `complete_generation_tx` and the
cancel/failure paths pass a real one only when available at that moment.
"provider_request_id" maps to the real `generation_attempts.provider_job_id`
column; "media_id" maps to `media_assets.id`, joinable by both
`generation_id` and the narrower `generation_attempt_id`. No distinct
"artifact" concept exists anywhere in this schema — `media_assets` already
IS the artifact record, so "artifact_id" is classified `NOT_APPLICABLE`
rather than invented. `buildTraceChain()` (pure, in
`generation-investigation-contract.ts`) derives every link's status from
what was actually queried for that one generation; a link with no evidence
renders `NOT_PERSISTED`, never a silently-dropped field.

### Four narrow, concurrent, explicit-column reads — nothing else

`generation-investigation-service.ts`'s `getGenerationInvestigation` reads
`generations`, `generation_attempts`, `outbox_events`, and `media_assets`,
each filtered by the one generation id, each with an explicit column list
(never `*`), each bounded with `LIMIT 50`. Deliberately excluded from every
select even though the columns exist: `generations.prompt`/
`negative_prompt`/`input_url`/`output_url`/`thumbnail_url`/`error_message`/
`metadata`; `generation_attempts.cost_amount`/`cost_currency` (Phase 10
boundary — a future, separately reviewed admin billing slice, not this
one); `outbox_events.payload`; `media_assets.object_key`/`bucket`/
`declared_*`. A malformed generation id (reusing the existing
`GENERATION_ID_PATTERN` from `generation-api-contract.ts`, not a new one)
never reaches the database at all.

### Same admin boundary, same opaque-404 convention

`/api/admin/generations/[generationId]` calls `requireAdminAccess()` —
the identical Phase 16/1 boundary, never `ROUTE_ADMIN_CLERK_USER_IDS`.
Denial and a genuine missing generation both answer 404; they are
distinguished only by response body shape (`{error:"not_found"}` vs. the
full `{outcome:"GENERATION_NOT_FOUND"}` result), and a non-admin caller can
never reach the code path that produces the second shape, so nothing leaks.

### Not in this slice

Users, Workspaces, and Risk screens (16-A's official package still needs
all three); alert-history/recovery-incident persistence; any operational
action (retry, cancel, redrive, route/provider mutation, billing); Phase
16-A's own done criterion ("admin can trace a user/generation event
end-to-end") is now reachable for the generation half but not yet for a
user- or workspace-scoped starting point. **Phase 16-A is not complete.**

## Phase 16-A/3 — read-only user investigation (code-only)

Answers one operator question: "what has happened for this user recently,
and which generation can I inspect end-to-end?" — a user summary plus its
recent generations, each linking into the existing 16-A/2 generation
investigation surface by id. No operational action of any kind.

### The canonical user owner, and a defensive read split (not a grant workaround)

`public.profiles` (`clerk_user_id` primary key,
`supabase/migrations/20260805132704_remote_schema.sql`) is the one
user-identity table in this schema. `generations.clerk_user_id` and
`projects.clerk_user_id` both carry `REFERENCES profiles(clerk_user_id) ON
DELETE CASCADE`, so `generations.clerk_user_id` — the same ownership column
16-A/2 already trusts — is a safe, existing ownership relation for "this
user's recent generations." No workspace table exists in this schema at
all; "workspace" only ever means `projects` here (Phase 16-A/4 reconciles
the roadmap's "Workspaces" label to this table — see that section below).

**Correction (Phase 16-A/3 post-implementation audit, carried forward in
Phase 16-A/4):** the original version of this section claimed `profiles`
grants `service_role` only `REFERENCES,TRIGGER,TRUNCATE,MAINTAIN` — no
`SELECT` — citing only `20260805132704_remote_schema.sql`. That was an
incomplete read of the migration history. A later migration,
`20260811120000_credit_system.sql` (line 127), issues `GRANT ALL ON TABLE
"public"."profiles" TO "service_role"`, and no migration anywhere in this
repository ever revokes anything from `service_role` on any table.
Repository evidence, taken as a whole, is
`PROFILE_SERVICE_ROLE_SELECT_REPOSITORY_STATUS: CONFIRMED_PRESENT`. Live
database state was not independently queried and stays a separate,
`NOT_VERIFIED` question. **`PROFILE_GRANT_GAP: NONE`; no migration is
required or was created for this.**

`user-investigation-service.ts` still runs the `profiles` read and the
`generations` read as two INDEPENDENT fallible reads rather than one
combined `Promise.all` + single catch — kept as ordinary defensive
discipline, not because a grant gap is expected. It costs nothing, it is
correct under either grant state, and it means a `profiles`-specific
failure of any kind (a future grant change, a transient error, an RLS
regression) degrades to `PARTIAL_DATA` — real generation evidence still
shown, honestly labelled as missing identity enrichment — instead of
discarding real evidence because an unrelated read had a bad moment. If
both reads fail, or the `profiles` read fails and no generation evidence
exists either, the result is `EVIDENCE_UNAVAILABLE` — existence is never
guessed.

### Two narrow, independent, explicit-column reads — nothing else

`getAdminUserInvestigation` reads `profiles` (one row, `clerk_user_id,
display_name, created_at, updated_at`) and `generations` (up to 20 rows,
`id, status, generation_type, created_at, updated_at, completed_at,
project_id`, ordered `created_at desc`), each filtered by the requested
`clerk_user_id`, each with an explicit column list (never `*`). Deliberately
excluded even though the columns exist: `profiles.email`/`username`/
`avatar_url` (PII this slice minimizes away entirely) and
`profiles.credits`/`plan` (the same Phase 10 economic-truth boundary 16-A/2
already draws around `cost_amount`/`cost_currency` — a future, separately
reviewed admin billing slice, not this one); every `generations` column
16-A/2 already excludes (`prompt`, `negative_prompt`, `input_url`,
`output_url`, `thumbnail_url`, `error_message`, `metadata`) plus
`provider`/`model`, which belong to the per-generation view, not this
user-level list. A malformed Clerk user id (`CLERK_USER_ID_PATTERN`, this
slice's own pattern, matching the `user_<id>` shape every Clerk identity in
this codebase already uses) never reaches the database at all.

### Same admin boundary, same opaque-404 convention

`/api/admin/users/[clerkUserId]` calls `requireAdminAccess()` — the
identical Phase 16/1 boundary, never `ROUTE_ADMIN_CLERK_USER_IDS`. Denial
and a genuine missing user both answer 404; they are distinguished only by
response body shape (`{error:"not_found"}` vs. the full
`{outcome:"USER_NOT_FOUND"}` result), and a non-admin caller can never
reach the code path that produces the second shape, so nothing leaks.

### Generation linkage — reused, not duplicated

Each recent-generation row links to
`/admin/generations?generationId=<id>` — the existing 16-A/2 investigation
surface. `user-investigation-service.ts` never re-implements attempt or
trace-chain logic: a structural test asserts the new files never re-declare
`buildTraceChain`/`TraceChainLink` and never re-query 16-A/2's own tables
(`outbox_events`, `generation_attempts`, `media_assets`).

### Not in this slice

Workspaces and Risk screens (16-A's official package still needed both, as
of this slice — Phase 16-A/4 adds Workspaces). Any operational action
(suspend, delete, role change, workspace-membership mutation, billing).
Phase 16-A's done criterion ("admin can trace a user/generation event
end-to-end") is now reachable starting from either a generation id (16-A/2)
or a user id (16-A/3). **Phase 16-A is not complete.**

## Phase 16-A/4 — read-only workspace/project investigation, and the 16-A/3 correction (code-only)

Two things in one batch: a read-only investigation surface answering "what
belongs to this project/workspace, who owns it, and which generations can I
inspect end-to-end?", and a correction of the stale profile-grant claim the
16-A/3 post-implementation audit found in that slice's commentary.

### The 16-A/3 correction

The 16-A/3 implementation claimed `profiles` grants `service_role` only
`REFERENCES,TRIGGER,TRUNCATE,MAINTAIN` — no `SELECT` — citing only
`20260805132704_remote_schema.sql`. The 16-A/3 post-implementation audit
found this incomplete: `20260811120000_credit_system.sql` (line 127) issues
`GRANT ALL ON TABLE "public"."profiles" TO "service_role"`, six days after
the narrower grant, and no migration anywhere in this repository ever
revokes anything from `service_role` on any table. Taken as a whole,
repository evidence is `PROFILE_SERVICE_ROLE_SELECT_REPOSITORY_STATUS:
CONFIRMED_PRESENT`; live database state was not independently queried and
stays `NOT_VERIFIED` as a separate question. `PROFILE_GRANT_GAP: NONE`;
**no migration was created for this, in 16-A/3 or here.** The stale claim is
removed from `user-investigation-contract.ts`, `user-investigation-
service.ts`, and the 16-A/3 test's rationale comment (the behavioral
assertion — `profiles` and `generations` reads stay independent, a
`profiles` failure with real generation evidence still reports
`PARTIAL_DATA` — is unchanged and re-verified by this batch's own regression
run). The independent-read split itself is kept, reframed as ordinary
defensive discipline rather than a workaround for a documented gap: it costs
nothing, it is correct under either grant state, and it means any future
`profiles`-specific failure (a grant change, a transient error, an RLS
regression) still degrades honestly instead of discarding real evidence.

### "Workspace" reconciled to `projects`, not invented

The roadmap names a "Workspaces" screen; no `workspaces` or
`workspace_members` table exists anywhere in this schema, and this batch
does not create one. The closest and only canonical concept is
`public.projects` (`id` uuid PK, `clerk_user_id NOT NULL REFERENCES
profiles(clerk_user_id)`, `title` 1–150 chars, `status` enum, timestamps),
with `generations.project_id REFERENCES projects(id) ON DELETE CASCADE`. The
screen and its nav entry are labelled "Workspace / Project" throughout, not
bare "Workspaces" — naming the roadmap concept honestly without pretending a
separate entity exists.

### Two narrow, independent, explicit-column reads — nothing else

`getAdminWorkspaceInvestigation()` (`workspace-investigation-service.ts`)
reads `projects` (one row, `id, title, status, clerk_user_id, created_at,
updated_at`) and `generations` (≤20 rows, `id, status, generation_type,
created_at, updated_at, completed_at`, filtered by `project_id`, ordered
`created_at desc`), each with an explicit column list. Deliberately
excluded: `projects.description` (free-form user prose) and
`projects.thumbnail_url` (points at rendered media); every `generations`
column 16-A/2 already excludes, plus `provider`/`model`/`clerk_user_id`
(the workspace's own `ownerClerkUserId` already carries the owner
reference). The two reads are independent for the same reason 16-A/3's are:
a `projects`-only failure with real generation evidence present degrades to
`PARTIAL_DATA` rather than discarding it — ordinary defensive discipline,
not a response to a known `projects` grant issue (repository evidence
already shows `service_role` has `SELECT` on `projects`,
`20260805132704_remote_schema.sql`). Outcomes: `WORKSPACE_NOT_FOUND`,
`EVIDENCE_UNAVAILABLE`, `PARTIAL_DATA`, `NO_GENERATIONS`, `FOUND` — the same
shape 16-A/3 established. There is deliberately no `OWNER_NOT_AVAILABLE`
outcome: `projects.clerk_user_id` is `NOT NULL` on the row that establishes
the workspace's own existence, so it cannot independently fail once the
workspace is found — the same "`NOT_APPLICABLE`, not invented" standard
16-A/2 applies to `artifact_id`.

### Owner and generation linkage — reused, not duplicated

The owner is exposed as a bare `clerk_user_id` reference, never enriched by
a `profiles` read in this service — it links to `/admin/users?clerkUserId=
<id>` (16-A/3), the same "link by id, don't re-implement" precedent 16-A/3
itself set by linking to `/admin/generations?generationId=<id>` (that query
param is not yet consumed by either target page — an existing, accepted gap
this batch does not change). Each recent-generation row links to
`/admin/generations?generationId=<id>` (16-A/2). A structural test asserts
the new files never re-declare `buildTraceChain`/`TraceChainLink`, never
re-query 16-A/2's tables, never re-implement `getAdminUserInvestigation`,
and never query `profiles`.

### Deliberately deferred: by-owner project listing

`projects.clerk_user_id` ownership is unambiguous (`NOT NULL`, FK-backed),
so listing a user's projects would be safe to build. It is left for a future
slice anyway: the brief asked for the narrowest service, and a by-owner list
is a second query shape (bounding, ordering, its own UI) this slice's
primary question — investigate one project id — does not need.

### Same admin boundary, same opaque-404 convention

`/api/admin/workspaces/[projectId]` calls `requireAdminAccess()` — the
identical boundary every Phase 16 admin route reuses, never
`ROUTE_ADMIN_CLERK_USER_IDS`. Denial and a genuine missing workspace both
answer 404, distinguished only by response body shape.

### Not in this slice

Risk screen (16-A's last remaining official package item) and Dashboard
completion. Any operational action (edit, delete, rename, transfer
ownership, member management, generation mutation). By-owner project
listing (see above). Phase 16-A's done criterion is now reachable starting
from a generation id (16-A/2), a user id (16-A/3), or a project id
(16-A/4).

## Phase 16-A closure — Risk investigation + Dashboard completion (code-only)

The last two items of the official 16-A package (`Dashboard, Users,
Workspace/Project, Risk, Generations, Attempts, Traces`): a read-only Risk
investigation surface, and a dashboard that links out to every real 16-A
screen. With this batch, **every name in the official 16-A package is a real
screen** and the done criterion — "admin can follow a user/generation event
end-to-end" — is proven by an explicit integration test, not just asserted.

### Risk — the canonical evidence, not a second one

`public.security_events` (Phase 12-C, `supabase/migrations/
20260826000000_security_events.sql`, extended — not duplicated — by
`20260827000000_policy_decision_evidence.sql`) is the one append-only
security/risk evidence log in this repository, and the one this surface
reads. It already carries `risk_score` and `recommended_action` per row,
written at record time by the Risk Engine (`src/lib/security/
risk-engine.ts`, pure `assessRisk()`) — `risk-investigation-service.ts` reads
those STORED columns verbatim and never calls `assessRisk()` itself, which
would double-count recurrence and silently disagree with the row's own
score. `service_role` has had `SELECT` on `security_events` since
`20260826000000_security_events.sql` line 212 (`GRANT SELECT, INSERT`),
unchanged by every later migration. No TypeScript anywhere else in this
repository reads `security_events` back — this admin surface is its first
reader, exactly the design the migration's own comment anticipates ("Raw
security evidence is operator data").

Secondary, supporting evidence: `media_assets`' `quarantine_status`/
`moderation_status`/`moderation_engine`/`moderated_at`/`ingest_status`
columns — real per-asset safety state, not previously surfaced by any admin
read (16-A/2 reads `media_assets` but never selected these columns).

### Three lookup axes, each backed by a real column

`clerk_user_id` → `security_events.actor_clerk_user_id` (the verified actor)
+ `media_assets.clerk_user_id`. `generation_id` → `security_events.
resource_type = 'generation' AND resource_id = <id>` (a real but generic
text reference, not a dedicated FK) + `media_assets.generation_id` (an
actual FK). `trace_id` → `security_events.trace_id` only —
`media_assets` has no `trace_id` column, so a trace lookup never attempts a
`media_assets` read at all (not an omission; a real schema boundary).
`project_id` is deliberately NOT a lookup axis: `security_events` has no
`project_id` column, and joining through a project's owner would silently
answer "does this project's OWNER have risk evidence" while labelled as a
project lookup — a fabricated correlation this contract refuses to make.
`subject_hash` is also not a lookup axis: it is a one-way hash, and
re-deriving it from an operator-supplied value would mean guessing or
reimplementing the write-time hash function.

### Primary/secondary asymmetry, degrading honestly in both directions

`security_events` and `media_assets` are read as two independent fallible
reads (the trace_id axis only ever attempts the first). Because
`security_events` is the primary/canonical source: a `security_events`
success — even with genuinely zero rows — combined with a `media_assets`
failure is `PARTIAL_RISK_EVIDENCE` (the confirmed-empty primary result is
never discarded, and it is never silently upgraded to `NO_RISK_EVIDENCE`
either, since the secondary picture is still unknown). A `security_events`
failure combined with a `media_assets` success is `PARTIAL_RISK_EVIDENCE`
only when real secondary evidence exists; if the secondary is also empty,
the result is `RISK_SOURCE_UNAVAILABLE` — an empty secondary cannot stand in
for a primary source that was never actually read. `NO_RISK_EVIDENCE` fires
only when both applicable sources were successfully read and both are
genuinely empty. No risk evidence is never presented as "safe"; the panel
says so explicitly.

### Observational only

No quarantine release, no user suspension, no provider/route mutation, no
kill switch, no billing action, no `recordSecurityEvent`/`assessRisk` call
anywhere in the new files — a structural test bans every one of these
identifiers by name, plus the generic `.insert/.update/.upsert/.delete`
sweep every 16-A surface already uses.

### Dashboard completion

`/admin` (Phase 16/1's System Health page) gains a static "Start an
investigation" section (`AdminInvestigationEntryPoints.tsx`, a server
component with no fetch) linking to Users, Workspace/Project, Risk, and
Generations, each with a one-line description of the flow it starts. No
fake metric, no decorative count, no duplicated detail-screen content — a
structural test asserts the component never calls `fetch`/`useState`/
`useEffect`. `admin/layout.tsx`'s nav gains a real `Risk` link; `Incidents`,
`Cost / FinOps`, `Restore`, `Recovery`, `DLQ`, and `Providers / Routes`
remain labels, not routes — later Phase 16 packages, not 16-A.

### End-to-end proof of the done criterion

`phase-16-a-closure-end-to-end.e2e.test.ts` seeds one real generation and
walks it from three independent starting points — a user id, a project id,
and a security event's own correlation ids — proving the user-path and the
workspace-path arrive at the byte-identical `getGenerationInvestigation`
result (`assert.deepEqual`, not just matching outcomes), and that Risk
evidence joins the same real ids rather than being fabricated to make the
flow look complete. A second test proves the negative: a generation with no
`security_events` row reports `NO_RISK_EVIDENCE`, never an invented link.

### Cross-16-A sweep

One test file now walks every file under `src/lib/admin/`, `src/app/api/
admin/`, `src/app/admin/`, and `src/components/admin/` in a single pass,
asserting in one place: no `select()` anywhere names a forbidden column; no
raw Clerk object, token, secret, or signed URL shape exists anywhere; zero
mutation authority (database writes, provider execution, DLQ/queue
mutation, routing mutation, kill switch, quarantine release, restore/
remediation, billing, user/enforcement mutation, or re-scoring) exists
anywhere; every `/api/admin/*` route calls `requireAdminAccess()` and never
`ROUTE_ADMIN_CLERK_USER_IDS`; no page outside `layout.tsx` repeats the auth
check; every `/api/admin/*` route responds through `privateJson` (private,
no-store), never `NextResponse.json`; and `/api/health/live` remains
untouched. This does not replace each surface's own dedicated test file —
it is the belt to their suspenders, catching a regression that touches
several surfaces at once.

### Not in this batch

Nothing outside 16-A: no 16-B/C/D/E screen, no operational action anywhere,
no by-owner project listing (16-A/4's own deferred scope), no new admin
role/claim system (still the Phase 16/1 bootstrap allowlist). **Phase 16-A
is implementation-complete as of this batch** — Dashboard, Users, Workspace/
Project, Risk, Generations, Attempts, and Traces are all real, read-only
screens, and the done criterion is proven by an explicit end-to-end test.

## Phase 16-B — Failed Jobs/DLQ, Queue Health, Models/Providers, Router Controls

The first Phase 16 package with real operator MUTATIONS, not just
investigation. Official done criterion: an authorized operator can inspect
failed/DLQ work, safely redrive eligible SQS work, safely retry eligible
BullMQ auxiliary work, and disable a route — all through existing owners,
never a second implementation of any of them.

### Binding ownership preserved

Temporal remains generation-lifecycle authority; SQS remains critical
command transport; Phase 15-D remains the sole redrive safety-decision
authority; BullMQ/Redis B remains auxiliary-only (never lifecycle, never
provider execution, never billing); Phase 7 remains
models/providers/router mutation authority; Phase 13-D remains alert
routing authority; Phase 13-E's sensitive-data boundary is unchanged;
Phase 16 is presentation + an authorized, narrow action surface on top of
all of the above — never a second queue engine, lifecycle owner, routing
evaluator, or alert router.

### Failed Jobs / DLQ — inspection reused verbatim, one new redrive executor

`GET /api/admin/dlq` is `scripts/dlq-investigate.ts`'s exact wiring
(`createSqsDlqMessageSource` + `createSupabaseDlqRedriveSource` +
`investigateProviderDlq`, all Phase 15-D, unmodified), reused so the admin
read and the manual script's read can never diverge.

`POST /api/admin/dlq/redrive` is new: `sqs-dlq-redrive-executor.ts`
(`src/lib/aws/dlq-redrive/adapters/`, the same package, not a new one).
Standard SQS semantics mean a specific message can only be targeted by
receiving it WITH a real visibility timeout (claiming it) — the existing
Phase 15-D/3 investigation adapter's `VisibilityTimeout: 0` peek
structurally cannot yield a usable receipt handle, by design. The executor
receives with a real (short, 30s) claim window, evaluates through the
UNMODIFIED `evaluateDlqRedriveDecision` (Phase 15-D/1) against the exact
body it just received — never a client-supplied prior decision — and
either sends+deletes (only on a fresh `SAFE_TO_REDRIVE`) or releases the
message immediately via `ChangeMessageVisibility(0)` on any refusal, so a
refused message is visible to the next reader right away rather than after
the full claim window lapses. `StartMessageMoveTaskCommand` is deliberately
never used — it moves an entire DLQ→queue task, with no per-message target,
so it cannot express "redrive exactly the one message an operator just
reviewed." The orchestration logic is split behind an injectable
`DlqRedriveQueueClient` interface (mirroring `DlqMessageSource`'s existing
split) so the full receive→decide→send/delete→release flow is tested with
a fake at zero AWS cost — six real-behavior tests cover NO_MESSAGE, a
receive failure, `UNAVAILABLE` (no evidence source), `REFUSE_INSUFFICIENT_
EVIDENCE`, `REFUSE_TERMINAL_GENERATION`, and the successful `SAFE_TO_
REDRIVE` path (verified send-before-delete, correct `MessageGroupId`/
`MessageDeduplicationId`, no release on success). Two existing Phase 15-D
package-wide structural tests (`phase-15d1-dlq-redrive.e2e.test.ts`,
`phase-15d3-dlq-investigation.e2e.test.ts`) previously banned `SendMessage
Command`/`DeleteMessageCommand`/`ChangeMessageVisibility` across the WHOLE
package — both were narrowed (not weakened) to exclude exactly this one new
file, with a new companion test re-asserting the ban holds everywhere else
including any future file; `StartMessageMoveTask` stays banned with no
exception, anywhere. The existing atomic attempt claim
(`claimAttemptForSubmission`, inside `submitAttempt`) remains the sole,
unduplicated protection against double execution once a redriven command
is actually delivered — this executor is not a two-phase commit and does
not need to be one.

### Queue Health — SQS + BullMQ, combined, no duplicate truth

`GET /api/admin/queue-health` reuses Phase 13's own `readiness("provider-
worker")` for SQS status verbatim (that runtime's dependency matrix already
marks `sqs` CRITICAL) plus the same DLQ presence peek the Failed Jobs page
uses, plus real BullMQ per-queue job counts (`getJobCounts` against the
existing `getQueue()` factory, Phase 6R.8) — not a second CloudWatch alarm,
not a second queue-health truth, two already-real reads shown together.

### BullMQ — real code, honestly `NOT_CONFIGURED` today

`bullmq-admin-service.ts` calls the real, unmocked BullMQ `Queue`/`Job` API
(`getJobCounts`, `getFailed`, `job.getState()`, `job.retry()`) against the
existing Phase 6R.8 foundation — no second queue engine. Redis B is
genuinely unprovisioned in every environment
(`infra/modules/redis/main.tf`, `bullmq-foundation.test.ts`'s own header),
and none of the four named queues (`media-short`, `notifications`,
`cache-refresh`, `webhook-retry`) has a real job producer yet
(`queue-names.ts`'s own header: "NONE OF THESE QUEUES HAVE A REAL JOB
HANDLER YET"). Every BullMQ-touching test in this batch therefore exercises
the real code path at zero cost and asserts the honest `NOT_CONFIGURED`
outcome — this is `DEFERRED_EXTERNAL`, not a stub: the moment a future
phase wires Redis B and a real producer, this surface is already correct
against it, matching the same testing philosophy `bullmq-foundation.test.ts`
already established (never fake a live connection, never issue a real
command in a test). `job.data` and `job.stacktrace` are never read anywhere
in this surface — only bounded id/name/count/timestamp fields and a
300-char-truncated `failedReason`. Retry rechecks `job.getState()`
server-side immediately before calling `job.retry()` — a client claim of
"this job is failed" is never trusted.

### Models / Providers — catalogue only, `model_routes` deliberately excluded

`GET /api/admin/models-providers` reads `models`/`providers`/
`provider_models` (Phase 7) — bounded, explicit-column, no `model_routes`.
That table is the one existing read path (`listRoutesForAdmin`) gated by
the SEPARATE `ROUTE_ADMIN_CLERK_USER_IDS` allowlist; reading it directly
from this page, even read-only, would let any Phase 16 admin see
route-level data by visiting Models/Providers instead of `/admin/router`,
silently bypassing the boundary Phase 7-B deliberately drew. This surface
also deliberately never calls `health-aware-router.ts`'s circuit-breaker
snapshot to recompute live routing eligibility — doing so would mean a
second place reimplementing the router's own runtime decision, exactly the
"second routing evaluator" this phase must not become.

### Router Controls — `setRouteEnabled` reused, two authority layers kept separate

`GET /api/admin/router` / `POST /api/admin/router/disable` wrap
`listRoutesForAdmin`/`setRouteEnabled` (Phase 7-B) UNMODIFIED —
`router-admin-service.ts` adds only: catching the `FORBIDDEN`
`OrchestrationError` `assertRouteAdmin` throws internally and turning it
into a bounded `ROUTE_AUTHORITY_DENIED` outcome (never conflated with the
Phase 16 `requireAdminAccess()` opaque-404 denial — a valid Phase 16 admin
who is not also a Phase 7-B route admin gets an honest, distinct refusal,
never fabricated route data), input validation before either function is
ever called, and an audit log line. `setRouteEnabled` was chosen over
`setRuntimeRoutingControl`/`clearRuntimeRoutingControl` (the OTHER existing
Phase 7 mutation path, with its own built-in Phase 12-E policy gate and
TTL) specifically because it is one function, literally named for this
action, whose boolean parameter already gives a single reversible mutation
for both disable (`false`) and re-enable (`true`) — matching "reversible
enable/clear semantics" without adding a second mutation path. The runtime-
control path remains real, unmodified Phase 7 capability, deliberately not
wired into this UI to keep the action surface to exactly what the done
criterion asks for.

### The minimum safe action gate (Phase 16-B, not 16-E)

Every mutation (DLQ redrive, BullMQ retry, route disable) requires: an
authenticated Phase 16 admin (`requireAdminAccess()`), the resource
owner's own authorization where one already exists (`assertRouteAdmin` for
routes), a fresh server-side safety recheck immediately before acting
(the DLQ decision recomputed on the just-received message; BullMQ job
state rechecked via `job.getState()`), a required operator reason, and an
audit log line via the existing `createLogger()` (Phase 13-E — every field
passes through `sanitizeTelemetry` before being written). This is
deliberately NOT dual-control/two-person approval, passkeys, step-up auth,
or an OPA integration — those are Phase 16-E's to build. Extending Phase
12-E's policy registry (`policies/data/actions.json`) with new action
names for these three mutations was considered and deliberately NOT done:
registering a new critical action means deciding its role/two-person/
human-approval requirements, a real business decision this batch is not
positioned to make unilaterally, and doing so would mean editing the
shared Rego/conformance suite for a decision Phase 16-E should own.

### Audit evidence — logged, not yet durably queryable

Every mutation logs actor id, action type, target, reason, and outcome via
`createLogger()` (Phase 13-E's structured logger, already
`sanitizeTelemetry`-guarded). This is real, but it is NOT a durably
queryable audit table: `security_events` (Phase 12-C) is the one existing
durable evidence log, but its `kind` taxonomy is DB-CHECK-constrained —
adding new admin-action kinds would require a migration, and this batch
prefers no migration by default. No `admin_actions`/`dlq_history`/
`bullmq_history`/`router_history` table was created. This is a genuine,
named gap (`RISK_PERSISTENCE_GAP`-shaped, for actions rather than risk
evidence) that a durable, immutable audit store — the natural shape of
Phase 16-E hardening — should close; it is not silently invented here.

### Not in this batch

Route priority mutation (`setRoutePriority` — only enable/disable is
wired); by-owner BullMQ job listing beyond the four named queues; any
model/provider catalogue mutation (no CRUD console — inspect only, per the
roadmap's explicit boundary); a second, generic runtime-flag system (Phase
21's territory); passkeys/MFA/step-up auth/dual-control/OPA (Phase 16-E's
territory); provisioning AWS or Redis B infrastructure. **Phase 16-B does
not start 16-C.**

## Phase 16-C — Billing/Credits + Assets/Storage/Moderation

Official done criterion: admin can inspect financial state and
media/storage/moderation state from the same Operations Center, without
creating a second billing or media authority. Scope: Billing/Credits +
Assets/Storage/Moderation only — no new mutation surface beyond the
already-built Phase 9-E quarantine release action.

### Economic truth separation — three things that must never merge

Phase 10's `credit_wallets`/`credit_ledger`/`credit_reservations` (plus the
`credit_reconciliation` view) are the ONE economic ledger truth in this
schema. `billing-admin-service.ts` is its first TypeScript reader —
`src/lib/credits.ts` is write/reserve-only and its own header says "NOT
WIRED IN YET." Three things this surface deliberately keeps apart, all
documented in `billing-admin-contract.ts`'s header:

1. **Phase 10's ledger truth** (what this surface reads) — real money
   owed/spent, `credit_wallets`/`credit_ledger`/`credit_reservations`.
2. **Phase 15-B's cost ESTIMATE** (`cost-contract.ts`: "THIS IS AN
   ESTIMATE. IT IS NOT SPEND, AND IT IS NOT MONEY OWED") — never fetched
   here, not even side by side. A structural test bans
   `credit_price_per_unit` reads and any `finops/cost-contract` import
   anywhere in the new files, mirroring Phase 15-B's own ban in the other
   direction.
3. **Stripe** — zero integration in this repository (no `stripe`
   dependency, no webhook, no customer/subscription table). The panel
   renders the static constant `STRIPE_INTEGRATION_STATE =
   "STRIPE_NOT_CONFIGURED"`, never a live probe.

`getAdminBillingView` runs four INDEPENDENT fallible reads
(wallet/reconciliation/ledger/reservations) and combines them into
`NO_ACCOUNT` (all succeed, zero evidence) / `LEDGER_UNAVAILABLE` (all
fail) / `PARTIAL_DATA` (mixed) / `FOUND` — the same defensive discipline
16-A/16-B's admin services already use, so a transient failure on one
table degrades rather than discards real evidence from the others. No
`.rpc(` call exists anywhere in `billing-admin-service.ts` —
`reserve_credits`/`settle_reservation`/`refund_reservation`/
`grant_credits` remain Phase 10's own mutation surface, untouched.

### Assets / Storage / Moderation — one canonical table, one service, two pages

`public.media_assets` (Phase 9) is the one asset/storage/moderation truth
in this schema. `asset-admin-service.ts` is the ONLY new read of it, reused
by BOTH the Assets/Storage and Moderation pages (same bounded view,
different field emphasis) rather than building two competing reads —
`generation-investigation-service.ts` (16-A) and
`risk-investigation-service.ts` (16-A closure) already read narrower
slices of the same table for their own purposes; this contract's view is a
superset, not a competing definition.

Deliberately excluded from `AssetDetailView` and `ASSET_COLUMNS`:
`bucket`/`object_key`/`backup_bucket`/`backup_key`/`backup_version_id`/
`backup_etag` (real storage locations/credentials-adjacent identifiers —
`storage_backend`/`backup_backend`/`backup_status` answer "where and in
what state" without leaking the path); `declared_content_type`/
`original_filename` (provider/browser-declared, untrusted);
`legal_hold`/`retention_policy`/`data_class` (Phase 23 hooks with no real
values yet). `storageBackend` (the live/delivery location) and the
`backup*` fields (the DR/S3 evidence) are kept as clearly separate fields,
never merged into one "storage state" — R2 stays canonical, S3 stays
DR-only, and the view never implies otherwise.

### Moderation's release action is REUSED, not reinvented

`moderation-admin-service.ts` wraps Phase 9-E's
`requestMediaRelease`/`approveMediaRelease`/`rejectMediaAsset`/
`readSafetyAudit` (`src/lib/media/quarantine-release.ts`) UNMODIFIED. That
file already has real, tested, database-enforced two-person approval
(`media_release_approvals` PK on `(asset_id, approver_clerk_user_id)`),
`assertRouteAdmin` gating (the same separate `ROUTE_ADMIN_CLERK_USER_IDS`
authority `router-admin-service.ts` already distinguishes from Phase 16's
`requireAdminAccess()`), and a Phase 12-E policy gate
(`media.quarantine.request`/`.release`/`.reject`) called INSIDE those
three functions. `moderation-admin-service.ts` adds only: input validation
before either function is called, and catching the `FORBIDDEN`
`OrchestrationError` into a bounded `ROUTE_AUTHORITY_DENIED` outcome — the
same pattern `router-admin-service.ts` established for the identical
authority layer. No new authorization layer, no new policy gate
registration (`policies/data/actions.json` is unchanged by this batch —
verified structurally), and no new two-person mechanism was built. This is
"expose the smallest safe admin action" territory (explicitly permitted by
the phase brief), not Phase 16-E's dual-control/passkey/step-up-auth
territory.

`readSafetyAudit` reads `media_safety_audit` (Phase 9-E), a REAL,
already-durable, append-only (trigger-enforced) audit table — stronger
evidence than Phase 16-B's `createLogger()`-only action logging, exposed
here read-only rather than duplicated.

### Testability difference from Phase 16-B

Unlike 16-B's DLQ redrive/BullMQ retry (real AWS/real Redis B, correctly
classified `DEFERRED_EXTERNAL`), the moderation release action is
Supabase-RPC-based and fully testable offline: `FakeSupabaseClient` (the
zero-cost E2E harness) already supports `.rpc()`, and
`phase-16c-moderation.e2e.test.ts` exercises `performModerationAction`'s
request/approve/reject paths — including the "two approvals of an
unmoderated asset still fail" and "awaiting second approval" cases —
end to end against real production code. `QUARANTINE_RELEASE` is `PASS`,
not `DEFERRED_EXTERNAL`.

### Not in this batch

FinOps/cost-estimate display of any kind (deliberately, to avoid the
conflation Phase 15-B's own contract forbids); a live Stripe integration
or check (none exists in this repository); any new mutation beyond the
already-built quarantine release action (no wallet adjustment, no ledger
correction, no asset deletion/restore); a durable admin-action audit table
for Billing/Assets reads (same named gap as 16-B — `security_events`'
`kind` taxonomy is DB-CHECK-constrained, no migration by default this
batch); passkeys/MFA/step-up auth/OPA integration (Phase 16-E's
territory). **Phase 16-C does not start 16-D, and does not implement
16-E early.**

## Phase 16-D — Temporal Inspect/Cancel + Security Center/Audit/Incidents + SLO/Cost Guard + Deploy/Restore Health

Official done criterion: during an incident, the operator can see the
relevant operational timeline, health, safety, and control evidence from
one Phase 16 admin surface and can perform only those actions that already
have a canonical owner and safe authorization path. Scope: Temporal
inspect/cancel, Security Center, Incidents/Audit, SLO/Cost Guard,
Deploy/Restore Health — five screens, matching the IA grouping the phase
brief itself specifies, replacing every remaining `FUTURE_SECTIONS`
placeholder label the layout carried since Phase 16/1.

### Pre-implementation reality check (spec section 3), stated plainly

| Item | Classification | What that meant for this batch |
| --- | --- | --- |
| A. Temporal workflow inspect | OWNER_EXISTS_NEEDS_ADMIN_ADAPTER | `WorkflowHandle.describe()` is a standard SDK call this repository had never made; built as a thin, bounded adapter over the existing client/id owner. |
| B. Temporal cancel | ALREADY_EXISTS | Reused Phase 6R-H's `recordCancelIntent`/`requestGenerationCancellation` unmodified, wrapped Phase-9-E-style. |
| C. Security Center evidence | ALREADY_EXISTS | `security_events`, same columns 16-A's Risk Investigation already reads. |
| D. Audit evidence | ALREADY_EXISTS (two stores) | `security_events` policy-decision rows (12-E) + `media_safety_audit` (9-E). |
| E. Incident/alert evidence | OWNER_EXISTS, EPHEMERAL | 13-D's live dedupe map, extended with one bounded read accessor; honestly not durable. |
| F. SLO status | OWNER_EXISTS_NEEDS_ADMIN_ADAPTER | `evaluateSlo()` had no production caller anywhere in the repository before this batch. |
| G. Error budget/burn state | ALREADY_EXISTS | Computed inside `evaluateSlo()` itself — no second formula. |
| H. Cost Guard status | ALREADY_EXISTS | `runEstimatedSpendGuard()` is Phase 15-B's own real production entry point. |
| I. Deploy eligibility/health | EXTERNAL_INFRA_REQUIRED (full eligibility); OWNER_EXISTS (rollback signal) | No live CI/artifact/Vercel integration exists to construct an honest `DeploymentCandidate`; `evaluateRollback()` needed only real Phase 13/13-D inputs plus an honestly-null deployment identity, so it IS answerable. |
| J. Restore verification state | ALREADY_EXISTS | `runRestoreVerification()` is Phase 15-C's own real production entry point; its default restore target remains unconfigured, exactly as 15-C/1 shipped it. |
| K. Recovery/RTO-RPO state | NOT_PERSISTED (business decision) | `RTO_TARGETS`/`RPO_TARGETS` remain the empty registries Phase 15-D/2 shipped; no live incident-evidence source exists to feed `measureRecovery()` honestly. |

Two BLOCKED-adjacent findings, resolved without a migration: alert history
has no durable store (represented honestly as ephemeral, not built as a
new table — see Incidents/Audit below), and Deploy eligibility has no live
external evidence (represented as `DEPLOY_EVIDENCE_UNAVAILABLE`, never fed
a fabricated `DeploymentCandidate` just to get a verdict out of the
engine).

### Temporal Inspect — the first `describe()` call in this repository

`src/lib/temporal/workflow-inspection.ts`'s `describeGenerationWorkflow()`
uses the SAME cached `getTemporalClient()` (Phase 6R.2) and the SAME
deterministic `generationWorkflowId()` (Phase 6R.2) every existing
Temporal caller already uses — no second client, no second id scheme.
`describe()` returns `WorkflowExecutionDescription`, which carries no
workflow input/result payload by construction (those need a separate
`fetchHistory()`/`result()` call this module never makes); the projected
`WorkflowInspectionView` is a fixed allow-list — workflow id, run id,
status NAME (not the raw enum), three timestamps, task queue, a history
LENGTH count — explicitly dropping `memo`, `searchAttributes`, and the
`raw` protobuf response on principle, not by omission. `TemporalNotConfiguredError`
and `WorkflowNotFoundError` (both already-existing SDK/repository types)
map to `TEMPORAL_NOT_CONFIGURED`/`WORKFLOW_NOT_FOUND`; anything else is
`UNAVAILABLE` with a bounded reason code — never a silent empty result.
`temporal-admin-service.ts`'s `getAdminTemporalInspection` combines this
with the durable `generations` row (status) and the durable cancel intent
— see below for why that one read needs `metadata`, and what stays
bounded about it.

### Temporal Cancel — the one guarded mutation in the whole package

`performAdminTemporalCancel` follows Phase 9-E's quarantine-release
pattern exactly: fresh server auth (`requireAdminAccess()` at the route,
`durable_write` `guardRoute`), a current-state re-read immediately before
acting (never trusting what the panel showed), fail closed on a terminal
generation (`CANCEL_NOT_ALLOWED`, not an error), a required reason code,
and only then the existing canonical mutation. The mutation itself is
Phase 6R-H's `recordCancelIntent` — UNCHANGED authority, UNCHANGED
ownership check — plus `requestGenerationCancellation` (Phase 6R.3, the
same signal-based cancel the user-facing `/api/generations/[id]/cancel`
route already sends; no hard Temporal `terminate()`, no direct
`ProviderAdapter.cancel`, matching Phase 6R-H's own reasoning for why a
signal — which lets the workflow run its own cleanup activity — is used
instead).

The one real code change this required: `CancelIntentRecord` and
`recordCancelIntent` gained an ADDITIVE, backward-compatible extension —
an optional `actorClerkUserId` field on the record, and an optional
`{ adminActorId }` options parameter on the function. The ownership check
is NOT relaxed: the admin service still looks up the generation's REAL
owner and passes that as `clerkUserId` (satisfying the existing
compare-and-set exactly as before); `adminActorId` only additionally
stamps the record with who, distinct from the owner, initiated it, and
`reason` is prefixed `admin_cancel:<code>` so the two paths are
distinguishable in the durable row itself. Every existing caller of
`recordCancelIntent` (the ordinary user-facing cancel route) is
unaffected — a regression test in `phase-16d-temporal.e2e.test.ts` pins
that the ordinary path never gains an `actorClerkUserId`.

### Security Center + Incidents/Audit — one evidence table, one live alert map, two different questions

Security Center answers "what is happening right now, system-wide?" — the
same `security_events` columns 16-A's Risk Investigation already reads
(`risk_score`/`recommended_action` forwarded verbatim, never re-scored),
queried most-recent-first with an optional severity filter instead of
requiring an identifier. Incidents/Audit answers "what does the operator
need to see about ongoing incidents and past privileged actions?" — the
alert router's own live tracked state, plus the two already-durable audit
trails (`security_events`' `policy_decision_allowed`/`_denied` rows from
Phase 12-E, and `media_safety_audit` from Phase 9-E). Neither screen
invents a new evidence table.

`alert-router.ts` (Phase 13-D) gained `listTrackedAlerts()`: a bounded
read view of the SAME in-memory `entries` `Map` `raiseAlert`/`resolveAlert`
already maintained since 13-D shipped. Two small additive fields
(`type`/`resource`) were added directly to the existing `DedupeEntry` so
the read view does not need to parse them back out of the dedupe-key
string; nothing about `raiseAlert`'s or `resolveAlert`'s own behaviour
changed, pinned by `phase-16d-security-audit.e2e.test.ts` (a resolved
alert disappears from `listTrackedAlerts()`, exactly matching
`resolveAlert`'s existing semantics). Per the spec's own instruction, this
is represented HONESTLY as ephemeral — `alertHistoryPersisted: false` is a
literal field in the Incidents/Audit contract, not a comment — because it
is one process's memory, cleared on every restart or redeploy, never
shared across instances, and never durably queryable beyond "what this
process currently tracks." No second alert router, no new alert-history
table.

### SLO / Cost Guard — Phase 15-A finally gets a production caller; Phase 15-B's is reused verbatim

Before this batch, `evaluateSlo()` (Phase 15-A) had NO production caller
anywhere in this repository — a real gap Phase 15-A's own closure
documented ("Phase 15-A owns definitions and arithmetic. Nothing else").
`slo-cost-admin-service.ts` is the first one. It computes no second
opinion about any SLI: `readGenerationAttemptWindow` (the one new read
this batch added) counts terminal `generation_attempts` rows in a 1-hour
window and hands the counts to Phase 15-A's own `observeGenerationSuccess`/
`observeGenerationTimeouts`/`observeGenerationLatency` adapters;
`dependency_readiness` merges every `RuntimeName`'s CRITICAL dependency
probes from Phase 13's own `readiness()`; `realtime_debt_age` reuses the
existing `readRealtimeDebt()` (the same RPC the dispatcher already calls);
`provider_reliability` reuses Phase 7's own provider health store
(`getProviderHealth`). Every one of these six observations is handed,
unmodified, to `evaluateSlo()` — the arithmetic, the budget, the burn rate,
all Phase 15-A's own. `app_availability` is the seventh SLI and is
deliberately fed only a SINGLE current sample (well under the SLI's own
`minimumSamples: 10`) rather than a fabricated rolling history — this
repository persists no readiness-evaluation history, and adding one would
be exactly the "no migration by default" this batch avoids; `evaluateSlo`
reaches `INSUFFICIENT_DATA` on its own from that single sample, which is
the honest answer, not a workaround.

Cost Guard calls `runEstimatedSpendGuard()` (Phase 15-B/2's own real
production entry point — the same function `estimatedSpendGuardTask`
calls) verbatim, with its default 24-hour lookback. `COST_BUDGETS` remains
the empty registry Phase 15-B shipped; a pass today resolves to
`no_applicable_budget`, reported honestly rather than papered over. Never
merged with Phase 10's billing ledger — a structural test bans
`credit_price_per_unit`/`credit_ledger`/`credit_wallets`/`Stripe` anywhere
in the new files, the same boundary 16-C already drew in the other
direction.

### Deploy / Restore Health — real rollback signal, honestly unavailable full eligibility, verbatim restore reuse

The rollback half calls Phase 14-D's `evaluateRollback()` UNCHANGED, fed
real Phase 13 readiness (via the existing `collectAdminHealth()`, Phase
16/1's own projection) and real Phase 13-D open-CRITICAL-alert types
(`listTrackedAlerts()`, filtered). Deployment identity (`current`/
`previousGood`) is passed as `null` — honestly, not fabricated: this
repository has no deployment-identity tracking anywhere (no GitHub/Vercel
integration persists one), and `evaluateRollback()` already treats a
missing identity as a first-class input (`deployment_identity_missing`/
`unknown_previous_good`, both folding into `REVIEW_REQUIRED` rather than a
guessed rollback target) — exactly Phase 14-D's own "no guessing at a
target" rule, fed a real absence rather than worked around.

Full deploy ELIGIBILITY (`evaluateDeployment()`, which needs a specific
`DeploymentCandidate` — a risk class derived from a changed-file list, CI
check outcomes, an artifact digest, a preview state) is DELIBERATELY NEVER
CALLED. Constructing one from absent evidence — no live GitHub Actions/CI,
Vercel, or artifact-provenance integration exists anywhere in this
repository, matching Phase 14's own "no external integration is active" —
would be exactly the "fake unified truth" the spec's done criterion
forbids; `deployEligibility` instead reports
`DEPLOY_EVIDENCE_UNAVAILABLE` with a named reason. A structural test
(`phase-16d-deploy-restore.e2e.test.ts`) asserts `evaluateDeployment` is
never referenced anywhere in the new files.

Restore reuses `runRestoreVerification()` (Phase 15-C's own real
production entry point) verbatim, including its default `getRestoreEvidenceSource:
() => null` — an unmodified deployment therefore honestly reports
`unavailable`/`restore_target_not_configured`, the same shape Phase
15-C/1 shipped, not a fabricated pass. The panel text explicitly restates
Phase 15-C/2's own boundary: at most a local pg_dump/pg_restore round trip
between disposable containers is proven; live Supabase PITR remains
`DEFERRED_EXTERNAL`.

Recovery/RTO-RPO reports `RTO_TARGETS`/`RPO_TARGETS` (Phase 15-D/2) at
their real, current size — both `{}` — rather than inventing a target or
calling `measureRecovery()` with fabricated incident timestamps (no live
incident-evidence source exists anywhere in this repository to feed it
honestly). `RTO_RPO_NOT_CONFIGURED` is reported plainly; the panel states
outright that no target configured is not the same as a target being met.

### Structural proof, and the closure narrative

`phase-16d-closure-end-to-end.e2e.test.ts` walks one realistic incident
end to end through the REAL 16-D services (not a re-description of them):
a security event fires → Security Center shows it → the alert router
surfaces it as an open incident → the affected generation is inspected
through Temporal → the operator cancels it with a reason, through the one
canonical guarded action → the durable cancel intent attributes to the
admin on re-inspection → the rollback signal reflects the same open
CRITICAL alert. Cross-owner sweeps across every new file assert: no
redeclared `entries`/`assessRisk`/`evaluateSlo`/`computeErrorBudget`/
`evaluateCostGuard`/`evaluateDeployment`/`runRestoreValidation`; `COST_BUDGETS`
and `RTO_TARGETS`/`RPO_TARGETS` untouched; exactly one admin auth boundary
(`requireAdminAccess()`) reused everywhere, never
`ROUTE_ADMIN_CLERK_USER_IDS`; exactly one `durable_write` route in the
entire package (the Temporal cancel action); no locked product UI
referenced; no migration added anywhere.

### Not in this batch

Deploy execution, rollback execution, restore execution, remediation
execution (all remain exactly as unbuilt as their owning phases left
them); arbitrary incident resolution or security-event deletion; a
durable, queryable alert-history table (named as ephemeral, not built —
16-E's territory); a durable `admin_actions`/audit table beyond the two
already-durable stores this batch combines; RTO/RPO numeric targets (still
`UNDEFINED_BUSINESS_DECISION`); any live CI/artifact/Vercel/GitHub
integration; passkeys/MFA/step-up auth/OPA/dual-control (Phase 16-E's
territory). **Phase 16-D does not start 16-E.**

## Phase 16-E — Tier-0 admin security hardening

Official done criterion: an admin attempting a Tier-0 action has that
action's risk identified, their privilege tier checked, Clerk step-up
assurance checked, dual control checked where required, current state
re-read, the canonical action owner invoked only on ALLOW, and bounded
durable audit evidence produced — for both allowed and denied attempts.
Normal admin session compromise alone must not silently grant Tier-0
authority. Closes the exact gap 16-B/16-C/16-D each named by handoff text
("passkeys/MFA/step-up auth/dual-control/OPA — Phase 16-E's territory";
"a durable, immutable audit store — the natural shape of Phase 16-E
hardening").

### Role separation, additive to the Phase 16/1 bootstrap, not a replacement of it

`requireAdminAccess()`/`decideAdminAccess()` (Phase 16/1) are UNCHANGED —
49 existing call sites still ask exactly the question they always asked
("is this identity an admin at all?"). `src/lib/admin/admin-privilege.ts`
adds a NEW, finer question next to it: `resolveAdminPrivilegeRole()`
resolves `viewer` / `operator` / `tier0_admin` from three INDEPENDENT
env-var allowlists — the existing `CINEFIELD_ADMIN_CLERK_USER_IDS` now
means `viewer` only, plus two new, narrower lists
(`CINEFIELD_ADMIN_OPERATOR_CLERK_USER_IDS`,
`CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS`). This is the "bootstrap admin,
bounded" the spec asks for: Tier-0 authority no longer flows implicitly
from the one legacy list. Still a bootstrap (no Clerk org role/custom
claim exists in this repository — verified structurally), still
server-only, still default-deny, still no role a client can assert.

### The Tier-0 catalogue classifies authority; it never acts

`src/lib/admin/tier0-action-catalogue.ts` is a pure, zero-import data
module (structurally pinned) classifying every mutation Phase 16-A/B/C/D
actually exposes: `READ_ONLY` / `OPERATOR_MUTATION` / `HIGH_RISK_TIER0`,
a minimum role, whether step-up is required, whether dual control is
required, and the canonical owner. `queue.dlq.redrive`, `route.disable`,
`temporal.workflow.cancel`, `routing.control.set`/`.clear` and
`media.quarantine.release` are `HIGH_RISK_TIER0`; `queue.bullmq.retry`
and the quarantine request/reject actions are `OPERATOR_MUTATION` (lower
severity — BullMQ has no real backing infrastructure in any environment
today, per its own Phase 16-B contract). Deliberately does NOT extend
`policies/data/actions.json` (Phase 12-E's OPA-mirrored registry, bound
line-for-line to Rego + conformance cases) — step-up assurance is a
different concern from that action-policy ladder, and folding it in would
make Phase 12/19 the owner of MFA state too. Where an action IS already
registered there (`media.quarantine.release`, `routing.control.set/clear`),
that gate keeps running, completely unmodified, as an ADDITIONAL
condition, never replaced.

### Step-up assurance — honestly `NOT_CONFIGURED`, never fabricated

`src/lib/admin/step-up-auth.ts` (Clerk-free, mirrors `admin-auth.ts`'s
split) defines `resolveAssuranceEvidence()`: reads a documented
`cinefieldStepUp.verifiedAt` session claim, and returns `VERIFIED` only
for a fresh (≤5 minute) timestamp — `NOT_CONFIGURED` for everything else,
including every real request in this repository today, because no Clerk
MFA/passkey/custom-claim configuration exists anywhere (verified
structurally; this repository provisions no such Clerk feature and this
phase is not permitted to). `src/lib/admin/require-step-up.ts` is the
thin, Clerk-importing real caller (`auth().sessionClaims`), the one
documented exception to 16-A's "no `sessionClaims` anywhere" sweep.
`ElevatedSessionRecord` (short-TTL, actor-bound, Redis A-backed via
`src/lib/redis/admin-elevation-store.ts`) can ONLY be built from `VERIFIED`
evidence (`buildElevatedSession` refuses otherwise) — no custom MFA flow,
no password re-entry, no client-settable boolean anywhere in this chain.

### Dual control — one generic, reusable mechanism, reusing 9-E's PATTERN not its table

`admin_privileged_action_events` (new migration, see below) makes dual
control fall out of the SAME append-only event log the durable audit uses:
an `'approved'` event IS the approval, `actor_clerk_user_id` is the
approver, and the threshold is `COUNT(DISTINCT actor_clerk_user_id)` —
mirroring `media_release_approvals`' PK-based "approving twice is still
one approval" discipline without a second approvals table.
`record_admin_privileged_action_approval()` (SQL, `SECURITY DEFINER`)
structurally blocks the requester from approving their own request — not
an application-layer `if` a future call site could forget, a fact the
function itself enforces before any row is written. Phase 9-E's own
quarantine-release two-person mechanism is completely untouched and
remains the canonical dual-control owner for that one action; this
mechanism exists for actions that have no domain table of their own.

### The durable audit — one append-only event log, closes the named 16-B/C/D gap

New migration `20260829000000_tier0_admin_action_audit.sql`:
`admin_privileged_action_events`, service_role-only, RLS-revoked from
anon/authenticated, trigger-enforced append-only (identical mechanism to
`security_events`). NOT a widening of `security_events` — that table has
no request-lifecycle or dual-control concept and mixing a generic signal
feed with a privileged-action ledger would corrupt both taxonomies (the
same reasoning 12-E used in the other direction to justify widening
12-C instead of creating a third table). NOT a reuse of
`media_safety_audit`/`media_release_approvals` — asset-shaped tables
Phase 9-E explicitly built "for Phase 16 to adopt" as a PATTERN, not to
widen. Every lifecycle transition (requested/denied/
awaiting_second_approval/approved/rejected/executed/execution_failed/
expired) is its OWN immutable row correlated by `request_id` — never a
mutable "current state" row updated in place, so Section 13's
immutability requirement is structural, not a convention. Bounded fields
only: actor, action type, target type/id, reason code, correlation id,
security classification, a short outcome-detail code, timestamp. No
prompt, payload, secret, token, signed URL, or raw stack — enforced both
by CHECK constraints and by a structural test scanning the migration's
executable SQL. `src/lib/admin/privileged-action-audit.ts` is the only
writer/reader; `GET /api/admin/privileged-audit`
(`src/app/admin/privileged-audit`) is the bounded, filter-only (actor/
action/target/event/time-window) query UI Section 14 asks for — no
arbitrary SQL, no unbounded history (`PRIVILEGED_AUDIT_MAX_ROWS`).

### Enforcement mode — SECURITY FIX BATCH: observability only, never a bypass

**This section previously described a real, shipped defect, corrected in a
follow-up security fix batch — the correction is documented here in place
of the original claim, not appended as an addendum, because the original
claim is no longer true of the code.**

The original version of `authorizeTier0Action()` let
`CINEFIELD_TIER0_ENFORCEMENT_MODE` turn a real `deny` into `allowed: true`
whenever the env var was not the exact string `"enforce"` — which is the
**default**, unset state. A post-implementation closure audit
(`PHASE 16-E MASTER CLOSURE AUDIT`) traced this live through the full
production call chain (route → service → `authorizeTier0Action` →
caller's `if (!decision.allowed)` guard) and proved: a normal admin
session — no Tier-0 role, no step-up, no elevation — could execute
`queue.dlq.redrive`, `route.disable`, and `temporal.workflow.cancel`,
directly violating the binding invariant this phase exists to enforce.
The audit's own verdict: `PHASE_16_E_FINAL_STATUS: FAIL`,
`TIER0_SHADOW_MODE: FAIL_OPEN`.

The fix removed the lever entirely. `authorizeTier0Action()`'s `allowed`
field is now the authorization truth, always — `role_not_permitted`,
`step_up_not_configured`, `step_up_not_elevated`, and
`awaiting_second_approval` return `allowed: false` unconditionally, in
every mode, with no exception. `CINEFIELD_TIER0_ENFORCEMENT_MODE` still
exists and is still parsed (`tier0EnforcementMode()`, replacing the old
`tier0EnforcementModeEnabled()`), but it is now stamped onto the returned
decision as `enforcementMode` for logging/telemetry/rollout-dashboard
purposes ONLY — it changes nothing about whether a caller may proceed.
Every value other than the exact string `"enforce"` (missing, empty,
whitespace, wrong case, a typo, or the literal `"shadow"`) resolves to
the `"shadow"` label, and that default is now SAFE in a way it was not
before this fix, because `"shadow"` no longer means "bypass."

**Practical consequence, stated plainly:** because live Clerk MFA/passkey
configuration is honestly `NOT_CONFIGURED` in every environment today,
every `HIGH_RISK_TIER0` action that `requiresStepUp` — DLQ redrive, route
disable, Temporal cancel, quarantine release — is now refused for every
caller until an operator provisions that external Clerk configuration.
That is the correct fail-closed behavior the roadmap always asked for,
not a regression: the phase's own security-fix brief was explicit that
this may "temporarily make Tier-0 actions unusable in the current
environment... do not create a bypass merely to keep the button
functional." `queue.bullmq.retry` (`OPERATOR_MUTATION`, no step-up
required) is unaffected.

`phase-16e-tier0-authorization.e2e.test.ts`,
`phase-16e-wired-actions.e2e.test.ts`, `phase-16e-closure-end-to-end.e2e.test.ts`,
and the new `phase-16e-security-fix.e2e.test.ts` all pin the fixed
contract — including tests that assert the DEFAULT (env unset)
configuration denies an unauthorized actor through the full production
call chain, which is the exact coverage gap that let the original defect
ship: the pre-fix test suite only exercised the invariant under an
explicit `enforce: true` override, never under the actual default.

### CSRF, canonical owners, AI reachability

**CSRF — SECURITY FIX BATCH addition.** The closure audit found every
privileged mutation route relied only on implicit protection (Clerk
session-cookie `SameSite` behavior, unverifiable from this repository
since `@clerk/clerk-js` is CDN-loaded) and an informal assumption that a
cross-site `fetch()` triggers a CORS preflight — which is false for a
request declaring `Content-Type: text/plain` (a CORS-simple value) whose
body is nonetheless valid JSON text, since `Request.json()` parses body
bytes regardless of the declared header. `src/lib/security/privileged-
mutation-guard.ts`'s `guardPrivilegedMutation()` closes this with one
canonical, repository-owned, reusable check — no per-route logic — wired
as the FIRST call in every privileged mutation route, before
`requireAdminAccess()`: it rejects any request whose `Content-Type` is
not genuinely `application/json` (forcing a real cross-site attacker back
onto a real preflight this app never authorizes) and any request whose
`Origin` header is missing or does not match the request's own canonical
origin (derived from `request.url`, never a hardcoded production domain —
holds across production, preview deployments, and localhost with zero
configuration). It is identity-free by construction (verified
structurally — no Clerk/session/role reference anywhere in the module):
it answers only "did this request's browser-observable shape come from
this app's own origin," and a request that passes it still must separately
pass `requireAdminAccess()` — this is additive to Clerk authorization,
never a second authentication system. Wired into all five current
privileged mutation routes (DLQ redrive, route disable, Temporal cancel,
quarantine release, BullMQ retry) — not only the three Tier-0 actions,
since the other two share the identical browser/session threat model.

Canonical action owners are UNCHANGED: `setRouteEnabled` (7-B),
`redriveOneProviderDlqMessage` (15-D/16-B),
`recordCancelIntent`/`requestGenerationCancellation` (6R-H/6R.3),
`requestMediaRelease`/`approveMediaRelease`/`rejectMediaAsset` (9-E) are
all still called, unmodified, and this is pinned structurally too.
`tier0-authorization.ts` itself imports none of them — it decides, it
never acts. No MCP/AI-agent-facing module imports any Phase 16-E file
(`AI_REACHABLE_TIER0_ACTION = NO`); no code in this repository calls
`requireAiWritePolicy` (Phase 12-E's own AI write boundary) at all, and no
Phase 16-E file does either.

### Not in this batch

A live Clerk MFA/passkey production configuration (external, Section 25);
hard-enforcement flipped on by default for already-shipped actions
(a scoped, honest choice — see above); dual control extended to DLQ
redrive/route disable/Temporal cancel beyond the generic mechanism this
batch builds (no explicit roadmap mandate found for these three beyond
quarantine release and `routing.control.set/clear`'s own — unreached —
comment; `BUSINESS_DECISION_REQUIRED`); OPA runtime/sidecar (still
`CODE_CONTRACT_ONLY`, Phase 19's territory, unchanged by this batch);
persistent alert history (still Phase 13-D's ephemeral state — ownership
handoff unchanged, ephemeral-vs-durable is a separate concern from this
batch's privileged-ACTION audit); break-glass (not required — no hidden
super-admin bypass exists or was added); a second rate limiter (existing
`guardRoute({ routeClass: "durable_write" })` reused unchanged on every
wired route). **Phase 16-E does not start Phase 17.**

## Phase 17 — Cinefield Product Intelligence foundation

**Binding ownership rule, unchanged and enforced structurally.** Temporal
remains the ONLY generation lifecycle owner. Phase 17 decides WHAT a user
intends and WHAT should be generated; it owns none of: generation workflow
lifecycle, provider execution, retry/failover, finalization, billing
settlement, queue transport, or provider routing authority. Every module
below is pinned, by a real test, to import none of Temporal, the SQS/BullMQ
transport, or any `*-provider.ts` adapter
(`phase-17-product-intelligence.e2e.test.ts`, Security group).

### Reality audit (Section 2 of the brief) — classification table

| Concept | Classification |
|---|---|
| UserIntent / Core Coordinator / Manifest Compiler / GenerationManifest | MISSING — confirmed genuinely greenfield by a full-repo vocabulary sweep before any code was written |
| Specialist Director (as an architecture) | MISSING as architecture; but real specialist-shaped functions already existed (`classifyAndEnhancePrompt`, `moderateText`) and are reused, not reimplemented |
| Capability registry (execution) | ALREADY_EXISTS, narrow scope — `model-registry.ts` / `capability-validator.ts`, only the orchestratable model subset |
| Generation request contract | FOUNDATION_EXISTS — `GenerationCreateRequest` / `generation-settings-mapper.ts`, settings travel through the untyped `metadata` JSON |
| Control/Panel Schema Registry | MISSING — no unified shape; `cinemaStudioData.ts` is internally inconsistent and each studio (Create Image, Create Audio, Marketing Studio) duplicates its own control catalog independently (DUPLICATE_CONCEPT_EXISTS) |
| Studio Profile / saved creative preset | MISSING entirely — no user-saveable preset/template table or concept exists anywhere in the schema or code |
| Cinema Studio creative controls (genre, camera, era, tempo, palette, lighting) | PARTIAL — real, rich UI data exists but is not bound to any canonical, per-field execution-capability source |

Because the Control/Panel Schema Registry and Studio Profile concepts are
confirmed MISSING, Phase 17 does **not** invent structured, individually-
capability-validated fields for camera/lighting/genre/era/tempo/palette —
doing so would fabricate a capability guarantee the registry cannot actually
back (Manifest Honesty rule, Section 15). Those remain bounded, optional
free-text `styleHints` that compose into the final prompt — the same way
Cinema Studio already builds prompts today — never a validated control.

### What was built

- `src/lib/product-intelligence/user-intent-contract.ts` — `UserIntent`,
  bounded and fail-closed (`parseUserIntent`): explicit enums, size limits on
  every array/string, no provider/credential/lifecycle field exists to
  accept.
- `src/lib/product-intelligence/specialists/capability-specialist.ts` — the
  one deterministic, non-AI specialist. Calls the EXISTING
  `findModel()` / `resolveWorkflow()` / `validateCapabilities()` directly;
  never a second capability source.
- `src/lib/product-intelligence/specialists/prompt-specialist.ts` and
  `.../safety-specialist.ts` — thin wrappers around the EXISTING
  `classifyAndEnhancePrompt()` and `moderateText()` (both already shipped,
  both already Cloudflare Workers AI, opt-in, degrade-gracefully). No new
  paid service was added. `"unavailable"` is never treated as `"safe"` — the
  Safety Specialist's own return type has no path that collapses the two.
- `src/lib/product-intelligence/core-coordinator.ts` — deterministic
  composition only (calls each specialist once, combines results); no retry
  policy, no scheduling, no durable state.
- `src/lib/product-intelligence/manifest-compiler.ts` — deterministic;
  implements the exact conflict-resolution precedence from Section 14
  (safety/policy > capability > explicit user choice > specialist suggestion
  > default; the profile tier is skipped, not fabricated, since no profile
  system exists). Never selects a provider, never starts a workflow, never
  reserves credits, never writes terminal state.
- `src/lib/product-intelligence/generation-manifest-contract.ts` —
  `GenerationManifest`, versioned (`manifestVersion: "1.0.0"`), provider-
  neutral by construction (no `fal.*`/`runway.*`/`openai.*`/`xai.*`/
  `providerJobId`/`providerUrl`, pinned structurally), and explicitly
  excludes provider, credentials, queue receipt, Temporal state, retry
  counter, billing settlement state, and raw provider response.
- `src/lib/product-intelligence/compatibility-seam.ts` — pure mappers
  proving the layer CAN feed the existing generation admission seam:
  `mapGenerationManifestToCreateRequest()` produces the exact metadata shape
  `generation-settings-mapper.ts` already reads (`aspect_ratio`,
  `resolution`, `duration_seconds`, `image_count` as a fraction string,
  `mime_type`, ...), and the reverse mapper shows existing
  `GenerationCreateRequest` traffic could be represented as a `UserIntent`.
  Neither mapper calls Temporal, reserves credits, or writes a row.
- `POST /api/product-intelligence/compile` — one new, additive, optional
  route. Auth (`auth()`) then `guardRoute({ routeClass: "paid_compute" })`
  before the body is even parsed (pinned structurally), same shape as
  `/api/orchestration/enhance-prompt` and `/api/orchestration/moderate-text`.
  It compiles and RETURNS a manifest; it never creates a `generations` row,
  never calls Temporal, never reserves credits. `/api/generate` — the one
  canonical generation owner — is untouched.

### Integration seam decision (Section 16/17) — SUPERSEDED by the Roadmap Reconciliation batch below

The original narrowest-safe-integration choice (Option B: prove the seam CAN
feed admission, wire nothing) was correct for a first foundation batch, but a
subsequent independent closure audit found the seam mappers had ZERO
production callers — proven by test only, not consumed anywhere real. The
Roadmap Reconciliation batch (below) closes this: `POST
/api/product-intelligence/execute` is a real, live caller of
`mapGenerationManifestToCreateRequest()` now. `/api/generate`'s route handler
is still not modified — there remains exactly one canonical generation owner
and no silent dual production path; see the reconciliation section for the
exact mechanism.

### Persistence decision (Section 22)

**EPHEMERAL for this batch.** A `GenerationManifest` is computed on demand
by the compile endpoint and returned in the response; it is not written to
a new table and not stuffed into `generations.metadata` — that column
already has a real, established, unrelated consumer (`cancel-intent.ts`'s
cancel-intent data), and writing a second, versioned, provenance-carrying
shape into the same JSON column without a discriminated sub-key would be
exactly the "convenience persistence without checking existing schema
boundaries" anti-pattern the brief warns against. The settings SUBSET of a
compiled manifest already has a governed home once a caller chooses to feed
it through the existing seam — `mapGenerationManifestToCreateRequest()`
reuses that, unmodified. Durable manifest evidence (if ever wanted, once
this layer is wired into a live generation path) is a
`FUTURE_OWNER_HANDOFF` / `BUSINESS_DECISION_REQUIRED` item, not something
this batch had to invent a migration for. `MANIFEST_PERSISTENCE_DECISION_REQUIRED`
was not triggered — this is a reasoned EPHEMERAL choice, not an unresolved
blocker.

### Failure semantics

`ManifestOutcome` implements the brief's bounded enum exactly: `VALID`,
`PARTIAL`, `UNSUPPORTED_CAPABILITY`, `INVALID_INTENT`, `POLICY_REFUSED`,
`PROFILE_NOT_FOUND`, `CONFLICTING_CONTROLS`, `COMPILER_UNAVAILABLE`,
`SPECIALIST_UNAVAILABLE`. `PROFILE_NOT_FOUND` is intentionally unreachable
in this batch — `UserIntent` has no profile reference to fail on, since no
Studio Profile system exists yet — and is kept in the enum, not deleted, so
it is ready the day that system is built rather than requiring a breaking
enum change later.

### Not in this batch (original foundation batch, commit `9cbe22e`)

A "Camera Director"/"Style Director"/"Lighting Director" specialist (would
require a canonical, per-field control capability source that does not
exist — Control/Panel Schema Registry is still MISSING); a Studio Profile /
saved-preset system (still MISSING); wiring the compiled manifest
automatically into `/api/generate` (deliberately left as a proven-but-unwired
capability); durable manifest persistence (EPHEMERAL decision above); any new
OPA runtime or a second policy engine (Safety Specialist reuses Phase
12/moderation foundations only).

---

## Phase 17 Roadmap Reconciliation — official 17-A through 17-E, master
## roadmap v1.9.1 TEMIZ MASTER EK F

**Correction driving this batch.** The original Phase 17 implementation and
its first closure audit both worked from a summarized, non-authoritative
contract. The authoritative master roadmap (external, not a repository file)
names five official Phase 17 packages, 17-A through 17-E. This section
reconciles the already-built foundation against each, package by package,
implementing only what is honestly buildable now and reporting the rest
precisely rather than fabricating completion. Reconciled from THREE
independent, parallel, read-only research passes over the actual repository
(product-flow audit, virality/Supercomputer audit, MCP/builder audit,
workflow-engine/Phase-22 audit) before any code was written — not from
assumption.

**Real defect fixed first, per instruction.** An independent closure audit
of commit `9cbe22e` found `tsc --noEmit -p tsconfig.json` genuinely failing:
`phase-17-product-intelligence.e2e.test.ts:470` used the `/s` (dotAll) regex
flag, which requires an ES2018+ target while `tsconfig.json` targets ES2017.
The pattern (`/emit\(\{[^}]*prompt:/`) never needed dotAll — `[^}]*` already
matches newlines without it — so the flag was simply dropped. Neither
`npm run build` nor `node --test` (via `tsx`, which transpiles without a full
type-check) had caught this, which is why it shipped undetected; only a
direct `tsc` invocation surfaces it. Verified fixed: `tsc --noEmit` now
exits 0.

**Ownership correction: Control/Panel Schema Registry belongs to Phase 7,
not Phase 17.** The master roadmap places it there explicitly. Repository
reality is unchanged by this correction (it was already, and remains,
`MISSING` repo-wide) — only the *handoff owner* changes in this repo's own
docs, from an unattributed gap to a named Phase 7 dependency. The four+
independent per-studio control catalogs this creates (`cinemaStudioData.ts`,
`imageModelCapabilities.ts`/`createImageData.ts`, `voiceoverModelConfig.ts`,
Marketing Studio's inline constants) remain a real, pre-existing duplication
risk, untouched by Phase 17 — consolidating them would mean editing locked
Cinema Studio UI, which stays out of scope without an explicit unlock.

**Studio Profile intelligence, corrected framing.** `styleHints` is bounded
free text that composes into the final prompt — it is NOT profile
intelligence, and this batch does not claim it is. A real Studio Profile /
creative-preset system cannot be built honestly without the Phase 7
Control/Panel Schema Registry existing first (a profile needs real,
validated controls to reference — there is nothing to save a "preset" of
today beyond raw prompt text and the narrow settings fields `UserIntent`
already exposes). Recorded as a `FUTURE_OWNER_HANDOFF` dependent on Phase 7,
not built, not faked.

### 17-A — AI Director + model-specific Prompt Compiler + multilingual
### intelligence + Workflow/Skill Engine — COMPLETE

Done criterion: *"One intent becomes a model-aware executable generation
plan."*

- **AI Director**: satisfied by `core-coordinator.ts`'s `coordinateUserIntent()`.
  Deliberately not renamed to "Director" — that name is already load-bearing
  UI vocabulary in Cinema Studio ("Director Panel"). A repo-wide search found
  no other backend "Director" concept to reconcile against.
- **Model-specific Prompt Compiler**: a real hardening this batch, not
  cosmetic. `manifest-compiler.ts`'s `composePrompt()` previously composed
  `intent.prompt + styleHints` with no bound at all — meaning a manifest
  could carry a final prompt LONGER than the very `capabilities.maxPromptLength`
  the Capability Specialist had just validated the raw prompt against
  (styleHints are appended afterward, outside that check). `composePrompt()`
  now re-validates the FINAL composed string against the target model's own
  real, registry-owned limit and refuses (`UNSUPPORTED_CAPABILITY`,
  reason code `CAPABILITY_NOT_SUPPORTED:composed_prompt_exceeds_max_length:<limit>`)
  rather than silently truncating — no fabricated per-provider prompt format
  was invented, since none is documented anywhere in this codebase to compile
  against honestly.
- **Multilingual intelligence**: `settings.language` is real and
  capability-validated against `model.capabilities.supportedLanguages`. Raw
  multilingual text passes through unmodified — no auto-translation is
  performed, honoring an earlier roadmap phase's explicit instruction
  ("must not silently start translating or rewriting user text").
- **Workflow/Skill Engine**: reconciled, not rebuilt. No generic
  "skill"/"workflow engine" runtime exists anywhere in this repository (a
  dedicated audit confirmed zero hits beyond the narrow, pre-existing
  `WorkflowType` enum). `UserIntent` already IS the bounded "what
  steps/semantic requirements a product flow needs" description the
  roadmap's own definition asks for, and — per that same definition — already
  owns none of Temporal lifecycle/SQS/provider execution/credit settlement.
  A second, parallel type describing the same thing would duplicate a
  concept that already exists under a different name.
- **Real admission integration — the item that actually closes 17-A.**
  `POST /api/product-intelligence/execute` (new route) is a real, live HTTP
  path: `UserIntent` → Coordinator/Specialists → `GenerationManifest`, and —
  ONLY on a clean `VALID` outcome — straight into `createGeneration()` then
  `respondToGenerationRequest()`, the exact same two canonical functions
  `/api/generate/route.ts` calls, imported and called verbatim in the same
  order (pinned structurally). Any non-`VALID` outcome, including `PARTIAL`
  (e.g. safety unavailable), returns unexecuted — the same bounded shape
  `/compile` would already report. This is the "plan ≠ execution" boundary:
  a caller previews with `/compile` (no side effects, unchanged), and only a
  separate, deliberate `/execute` call can create real work.
  `createGeneration()`'s own `create_generation_tx` RPC already verifies the
  authenticated actor owns the target project (a foreign `projectId`
  surfaces as not-found) — reused verbatim, so this path inherits real
  tenant/project authorization automatically; nothing new was written for
  it, and nothing was skipped. `/api/generate/route.ts` itself is completely
  unmodified — this is a second CALLER of the same canonical admission
  functions, the same pattern its own doc comment already describes as
  normal ("the two wrapper routes" already do this for the compat-body
  shape), not a second lifecycle.

### 17-B — Cinema Studio + Marketing Studio + Soul/Character + Product
### workflows — PARTIAL

Done criterion: *"Four product flows use the same generation core."*

- **Cinema Studio**: EXISTS, real, LOCKED, untouched. Already reaches
  `createGeneration()`/`/api/generate` through its own `useGeneration()`
  hook — the same canonical core `/execute` also calls.
- **Marketing Studio**: EXISTS as a real, functioning UI
  (`MarketingStudioProductWorkspace.tsx`). Its default, visible
  target/mode/style catalog currently falls through to a `console.log`
  placeholder rather than a real call; only an internal `?model=` dev
  override reaches the same canonical path Cinema Studio uses. Not fixed
  this batch — wiring the visible catalog to real generation is a distinct,
  unauthorized UI change outside Phase 17's remit, not a Product
  Intelligence concern.
- **"Soul/Character"**: does not exist as a separate product flow. It is a
  capability toggle (`SoulGeneralCard.tsx`/`CharacterCardPopover.tsx`)
  nested inside `/image`'s `ImageForm.tsx`. Classified `NOT_APPLICABLE` as a
  fifth flow — the roadmap name maps onto an existing feature, not an absent
  product; nothing was fabricated to give it a standalone existence.
- **"Product"**: `AMBIGUOUS_NAME` — resolves to Marketing Studio's own
  `/product` page; no separate flow exists.

No locked or unlocked product UI file was modified to close this gap.

### 17-C — Virality analysis + Cinefield Supercomputer — DEFERRED_FUTURE

Done criterion: *"Plan becomes safe execution only after user approval."*

Virality analysis does not exist anywhere in the repository — "Viral
Presets" (`HeroCarousel.tsx`) is a marketing gallery label with zero
scoring/analysis logic behind it. `/supercomputer` (LOCKED, untouched) is a
UI shell whose composer reaches `/api/generate` only through a dev-only
`?model=` override; its visible model selector and category pills have no
click handlers at all, and no planning, cost-estimation, approval, or
quality-control concept is connected to it anywhere. Real, reusable
infrastructure a future 17-C batch could build on already exists,
unmodified: Phase 15-B's cost estimator (`cost-contract.ts`, real,
`ESTIMATE_BASED` only, never real spend) and Phase 16-E's step-up/elevated-
session mechanism (admin-scoped only, not an end-user "confirm before
spend" gate — no simpler end-user version exists either). Nothing was built
this batch: inventing virality-analysis scoring with no product spec, or
editing the LOCKED Supercomputer page, are both out of Phase 17's authorized
scope without explicit unlock.

### 17-D — MCP + Apps Builder + Websites Builder + Games Builder —
### DEFERRED_FUTURE / NOT_APPLICABLE

Done criterion: *"External clients/builders generate without provider
secret/routing exposure."*

None of the four exist in this repository, in code or docs, under any name.
This repository's own architecture contract section 31 already states "no
MCP server exists... target architecture, not implemented," and Phase
16-E's `AI_REACHABLE_TIER0_ACTION = NO` structural test already proves, by
scanning for and finding zero MCP/AI-agent-facing files, that nothing
reaches the admin boundary this way. Apps/Websites/Games Builder have zero
code and zero doc mentions anywhere in this repository. No placeholder
builder was created "to check a roadmap box," per this batch's own explicit
instruction — there is nothing here to connect a generation core to.

### 17-E — Model/prompt version changes + Phase 22 eval regression gate +
### Braintrust MCP — DEFERRED_TO_PHASE_22

Done criterion: *"No default route/prompt promotion without quality
measurement."*

Phase 22, an eval regression gate, and Braintrust are entirely unbuilt —
confirmed by direct repository search (zero implementation hits of any
kind). The only real artifact is a forward-declared landing pad Phase 7's
own routing code already owns and Phase 17 does not touch:
`src/lib/routing/route-quality.ts`/`routing-policy.ts` declare quality
weight as "EMPTY TODAY, on purpose... declared so Phase 22 has a place to
land, not so it can do something now," and
`phase-7d-cost-quality-routing.e2e.test.ts` pins that no quality column or
seed may exist before Phase 22. Nothing was implemented this batch, per
explicit instruction not to build Phase 22 prematurely.
`manifest-compiler.ts`'s new `MANIFEST_COMPILER_VERSION` constant (see
below) is a real, separate governance track Phase 22 could eventually gate
promotion against once it exists — that wiring remains Phase 22's to build,
not claimed done here.

### GenerationManifest hardening — `compilerVersion`

Added `MANIFEST_COMPILER_VERSION` (currently `"1.0.0"`), distinct from
`GENERATION_MANIFEST_VERSION`: one versions the compiler's DECISION logic
(precedence order, conflict detection, default-filling), the other versions
the manifest's FIELD SHAPE — the two can change independently. This is not
an arbitrary constant with no governance: it mirrors the precedent
`security-event-logger.ts`'s `policy_version` already established for
policy decisions in this exact codebase (adapted here since the compiler's
rules are code, not a separate data file the way
`policies/data/actions.json` is) — a documented, hand-bumped-on-real-change
convention, and a structural test pins that every compiled manifest carries
it, so it cannot silently rot out of sync.

### Tenant/project security, re-examined for the now-execution-capable path

The original compile-only endpoint did not verify `projectId` ownership
because its output was inert (never read, never granted access on the
strength of it). Now that `/execute` performs real admission, this was
re-examined and found already correctly handled: `createGeneration()`'s own
`create_generation_tx` RPC verifies project ownership server-side and
refuses a foreign project as not-found. Because `/execute` calls
`createGeneration()` verbatim — never a reimplementation — this protection
applies automatically; no new authorization code was written, and none was
needed.

### One canonical generation core — re-verified

`/api/generate/route.ts` is byte-for-byte unmodified by this reconciliation
batch. `POST /api/product-intelligence/execute` creates no second create-
owner, no second Temporal-start owner, no second router, no second provider-
adapter network, and no second billing reserve/settlement path — it is a
second CALLER of the one existing owner of each, never a second owner.
Verified by direct import audit: no file under `src/lib/product-intelligence/`
or the two `src/app/api/product-intelligence/*` routes imports Temporal, the
SQS/BullMQ transport, `src/lib/routing/health-aware-router.ts`, any
`*-provider.ts` adapter, or `src/lib/credits.ts`.

### External service boundary

No new LLM provider, no Braintrust runtime, no new orchestration service was
added or purchased. Every AI-assisted piece (`prompt-specialist.ts`,
`safety-specialist.ts`) continues to reuse the same, already-shipped
Cloudflare Workers AI functions from the original batch.

### Regression (this reconciliation batch)

Full suite: 1930/1933 pass. The 2 known pre-existing Phase-8 `ModelSelector`
pins remain, unrelated and unmodified. The one remaining failure at the
moment of this audit run is `phase-15a-slo-error-budget.e2e.test.ts`'s
git-status-snapshot test, which fails only while the working tree carries
uncommitted work — it clears once this batch is committed, as it has after
every prior phase in this session. `tsc --noEmit`, `npm run build`, ESLint,
`secrets:scan`, and `telemetry:scan` all pass clean. No new migration.

### Not in this batch (reconciliation)

A real Studio Profile system (blocked on the Phase 7 Control/Panel Schema
Registry, per the correction above); consolidating the four+ duplicate
per-studio control catalogs (would require editing locked Cinema Studio UI);
Marketing Studio's default catalog wired to real generation (unauthorized UI
change); any 17-C/17-D/17-E implementation (all genuinely absent or
future-phase-gated, per the audits above); Phase 22 in any form. **Phase 17
does not start Phase 18.**

---

## Phase 18 — Infrastructure as Code & Drift Management

**Authoritative roadmap source:**
`Cinefield_Master_Yol_Haritasi_v1.9.2_PHASE15_UZLASTIRILMIS_MASTER.docx`
(external, supplied directly for this batch). The prior audit in this
section (preserved in git history at commit `a0f7d90`, not repeated here)
worked from the strongest evidence available at the time — this repository's
own pre-existing "Gates not yet addressed" table, which scoped an old
`18-A` label to AWS infrastructure security hardening (SQS IAM, worker
message distrust) and correctly found both already complete under 6R-C/
12-D. That correction stands and is not reverted. It was, however, an
incomplete picture: the authoritative v1.9.2 roadmap names Phase 18 as
**Infrastructure as Code & Drift Management** — four official packages,
18-A through 18-D — a materially larger scope than the single stale gate
row suggested. This section replaces the prior audit's conclusion
(`PHASE_18_CAN_CLOSE: YES` on a "nothing to implement" basis) with the real
package-by-package implementation below.

**Binding ACTIVE/RESERVED rule.** IaC provisions ONLY active canonical
infrastructure. RDS, EKS, Lambda, API Gateway, Route53, CloudFront, and
ElastiCache all remain reserved/optional — none is declared as a Terraform
resource anywhere in this batch, pinned structurally
(`phase-18-infra-iac-drift.e2e.test.ts`, "Active/Reserved enforcement"
group, which scans every `.tf` file in the tree for exactly these resource
types).

### A real, pre-existing defect found and fixed, before anything else

`infra/README.md` had documented, since Phase 6R.16, that neither
`terraform` nor `tofu` had ever actually been run against this tree — "HCL
here is syntactically standard and hand-reviewed, but unverified by a
parser." This batch installed Terraform 1.9.8 locally and ran
`fmt -check` / `init -backend=false` / `validate` for real, for the first
time. Two real, previously-undetected problems surfaced:

1. **A formatting inconsistency** in `infra/modules/redis/outputs.tf`
   (misaligned map-literal `=` signs) — fixed by `terraform fmt`.
2. **A genuine `terraform validate` failure** in `infra/modules/iam/
   variables.tf`: the `dr_bucket_arn` and `media_scratch_bucket_arn`
   validation blocks used `var.x == null || !strcontains(var.x, "*")`.
   Terraform's `||` does not short-circuit `strcontains()`'s null check, so
   the ordinary, valid, default (`null`) state of these variables failed
   `validate()` with "argument must not be null" — meaning this module has
   never actually passed a real `terraform validate` in its entire
   existence until this batch. Fixed with `try(!strcontains(var.x, "*"),
   true)`, which only falls back to `true` (no wildcard — the variable is
   simply unset) if `strcontains()` itself errors. `coalesce(var.x, "")`
   was tried first and rejected: `coalesce` treats `""` as absent too, so
   `coalesce(null, "")` itself errors with "no non-null, non-empty-string
   arguments" — a second real gotcha, not a fix.

Both fixes are verified with real `terraform fmt -check` (exit 0) and real
`terraform validate` (Success) against all three roots
(`infra/bootstrap/`, `infra/environments/dev/`,
`infra/environments/production/`), re-run fresh at the end of this batch.

### 18-A — infra/ structure, IaC engine, remote state, environment separation — COMPLETE (code), remote state LIVE_EXTERNAL_REQUIRED

Done criterion: *"A staging environment can be created from an empty
environment using IaC."* **CODE_COMPLETE, LIVE_EXTERNAL_REQUIRED** — the
dev root already declared everything a staging apply needs (queues, IAM,
the Redis boundary declaration); nothing new was needed there. What was
missing, and is now real:

- **IaC engine: Terraform**, made explicit rather than left as
  "compatible with either." `infra/README.md` already described the HCL as
  written to be Terraform/OpenTofu-compatible with "no tool... inherited";
  this batch declares Terraform the canonical owner (the CI workflows pin
  `hashicorp/setup-terraform`) rather than introducing OpenTofu as a second
  engine, per this batch's own instruction.
- **Remote state + locking**: `infra/bootstrap/` (new) — a Terraform root
  declaring an S3 bucket (versioned, KMS-encrypted, public access fully
  blocked, deny-insecure-transport bucket policy) and a DynamoDB lock
  table, both `prevent_destroy = true` (losing either loses every
  environment's understanding of what it manages). `validate`-clean,
  verified live this batch. Both `infra/environments/{dev,production}/
  versions.tf` now declare an empty, PARTIAL `backend "s3" {}` block —
  real values come from a git-ignored `backend.hcl` at `init
  -backend-config=` time (a committed `backend.hcl.example` per
  environment documents the exact keys). **This bootstrap root has never
  been applied** — creating the real bucket/table is a live AWS account
  action this repository does not have credentials for, and CI's
  `infra-ci.yml` explicitly reports `SKIPPED_NOT_CONFIGURED` (not a fake
  green check) when the backend/OIDC role variables are unset.
- **Environment separation**: dev and production already used distinct
  `name_prefix`es (`cinefield-dev` / `dev-` queue prefix vs
  `cinefield-production`) and, now, distinct state **keys**
  (`dev/terraform.tfstate` vs `production/terraform.tfstate`) inside the
  ONE shared state bucket — one bucket, not one-bucket-per-environment
  (a second bucket would need identical hardening for no isolation
  benefit; IAM and the state key are what actually gate who reads which
  environment's state). Pinned structurally that the two keys can never
  collide.

### 18-B — controlled import of existing infrastructure — CODE_COMPLETE, import itself DEFERRED_EXTERNAL

Done criterion: *"Terraform/OpenTofu plan shows no unexpected destroy/
recreate."* The hand-created production resources (SQS queues, ECS
cluster, IAM roles — documented in `docs/operations/
AWS_PROVIDER_RUNTIME.md`) are **not** in this repository's Terraform state
(there is no state yet — see 18-A). `infra/environments/production/
main.tf`'s own header has said so since Phase 6R.16: "Applying this root
as-is would attempt to CREATE them again and fail on name conflicts.
Adoption means importing the existing resources into state first,
resource by resource, verifying an empty plan, and only then treating
Terraform as the owner." This batch did not perform that import — doing so
against real production resources without live AWS access, and without
the state backend existing yet (18-A), would be exactly the "import live
production infrastructure without explicit authorization" this batch was
told never to do. Classified `DEFERRED_EXTERNAL`, unchanged. What this
batch confirms instead: the Terraform *declarations themselves* already
match the real topology closely enough that `docs/operations/
AWS_PROVIDER_RUNTIME.md`'s resource inventory and `infra/modules/{sqs,
iam}/`'s resource shapes agree (queue names, role boundaries) — so the
eventual import, when a live account and credentials exist, is expected to
be a narrow reconciliation, not a redesign. `infra-apply.yml`'s own plan
step is the live proof this batch cannot produce: a real `terraform plan`
against imported state showing no destroy/recreate.

### 18-C — CI fmt/validate/plan, policy/security checks, human approval, protected production apply — CODE_COMPLETE, live protection LIVE_EXTERNAL_REQUIRED

Done criterion: *"Production apply can occur only through the protected
workflow."* Three new GitHub Actions workflows — **this repository had NO
CI workflows of any kind before this batch**, `.github/workflows/` did not
exist:

- **`infra-ci.yml`** (PR-triggered): `terraform fmt -check` once across
  the whole tree, then `init -backend=false` + `validate` for all three
  roots (matrix), then `npm run secrets:scan` (reusing the existing
  scanner rather than adding a new IaC-specific policy engine — a
  dedicated tool like tfsec/checkov is not part of this repository's
  toolchain today; adding one is a reasonable future addition, not built
  here, per the instruction not to implement Phase 19's policy runtime
  early). A separate `plan` job additionally runs a real `terraform plan`
  per environment and uploads it as a 90-day PR artifact — but ONLY when
  `vars.AWS_ROLE_ARN`/`vars.TF_STATE_BUCKET` are configured; otherwise it
  reports `SKIPPED_NOT_CONFIGURED` explicitly rather than a fabricated
  pass. Never runs `terraform apply`, pinned structurally.
- **`infra-apply.yml`** (the ONLY workflow that may apply production):
  `workflow_dispatch`-only (no `push` trigger — a human must deliberately
  start it), gated by a GitHub `environment: production`, requires a
  literal confirmation phrase input, fails closed (non-zero exit) rather
  than skipping when unconfigured, plans fresh inside the same run and
  applies EXACTLY that plan file (`terraform apply tfplan.binary`, never
  an implicit re-diff), and records actor/commit/environment/run-URL to
  the run's own step summary.
- **`infra-drift.yml`**: see 18-D below.

**What is CODE_COMPLETE vs. what remains LIVE_EXTERNAL_REQUIRED:** the
workflow YAML, the fail-closed-when-unconfigured behavior, and the plan-
then-apply-same-plan discipline are all real and pinned by test. The
GitHub *Environment protection rule* itself — the actual required-reviewer
gate `environment: production` depends on — is a live, external, one-time
repository Settings action this workflow file cannot configure from
within itself; until that's done, the YAML gate exists but is not yet
backed by a human-approval enforcement on GitHub's side. Documented, not
hidden, in `infra-apply.yml`'s own header and in
`docs/operations/INFRA_EMERGENCY_RUNBOOK.md`.

### 18-D — drift detection, alerting, emergency-change runbook — CODE_COMPLETE, live drift-checking LIVE_EXTERNAL_REQUIRED

Done criterion: *"Console drift produces an alert and a reconciliation
record."*

- **`infra-drift.yml`** (scheduled, daily, plus manual dispatch):
  read-only, never applies/destroys/imports. Runs `terraform plan
  -detailed-exitcode` against the real backend and classifies the ONLY
  three honest outcomes: `NO_DRIFT` (exit 0), `DRIFT_DETECTED` (exit 2),
  or `UNAVAILABLE` (missing credentials, init failure, or any other plan
  outcome) — a tool failure is never reported as drift-free, pinned by a
  dedicated test.
- **`POST /api/internal/infra/drift-report`** (new route) — the narrow
  seam CI evidence flows through into the app. Not `auth()`-gated (the
  caller is a CI job, not a browser); gated instead by one shared bearer
  secret (`CINEFIELD_INFRA_DRIFT_INGEST_TOKEN`, registered in
  `secret-registry.ts` as `SERVER_SECRET`/`CUT_OVER`, documented in
  `.env.example` and `docs/runbooks/secret-rotation.md`), compared with
  `crypto.timingSafeEqual` (never a plain `===`), fails closed (refuses
  every request) when unconfigured — no bypass mode. Delegates all body
  validation to `drift-report-contract.ts`'s `parseDriftReport()` — bounded
  fields only, no plan body, no diff, no state, no credentials ever
  accepted.
- **Alert Router reuse (13-D), not a second channel.** `alert-contract.ts`
  gained exactly two new catalogued types — `infra_drift_detected`
  (ERROR) and `infra_drift_check_unavailable` (WARNING, deliberately
  lower: a broken checker is not proof anything is wrong) — and
  `src/lib/infra/infra-alert-bridge.ts` (new, mirrors the existing
  `dr-alert-bridge.ts`/`recovery-alert-bridge.ts` pattern exactly) calls
  the SAME `raiseAlert()`/`resolveAlert()` every other producer uses. No
  second Telegram channel, no second SNS router, no second alert
  catalogue. `UNAVAILABLE` never resolves a standing `DRIFT_DETECTED`
  alert — going uncertain must not look like recovery, the same rule
  `dr-alert-bridge.ts` already follows.
- **`docs/operations/INFRA_EMERGENCY_RUNBOOK.md`** (new) — the sanctioned
  emergency-console-change path: make the change, record actor/reason
  immediately (in the incident channel/issue tracker — deliberately NOT a
  new database table, since the actor is a human on the AWS console, not
  a Clerk admin session or a GitHub identity, and does not fit Phase
  16-E's admin-privileged-action schema), confirm the immediate effect,
  reconcile Terraform via a normal PR through `infra-ci.yml`, review the
  plan shows no unexpected destroy/recreate, import if the resource wasn't
  Terraform-managed, confirm the next drift check reports clean, retain
  the evidence (the PR + workflow runs, already durably retained by
  GitHub). Explicitly states "console forever" is not acceptable.
- **Infra audit evidence, ownership decided.** Bounded evidence (actor,
  commit SHA, environment, action, result, timestamp, correlation via the
  workflow run URL) lives in the GitHub Actions run itself (`infra-apply.
  yml`'s step summary, `infra-ci.yml`'s plan artifacts) plus the alert
  envelope Phase 13-D already persists — not a new migration. Phase
  16-E's `admin_privileged_action_events` table was considered and
  rejected as the wrong owner: its schema is scoped to actions taken
  through this application's own Clerk-authenticated admin surface, and
  neither a CI job's GitHub identity nor a human on the AWS console fits
  that model — force-fitting either would duplicate a concept, not close
  a real gap. Recorded as the honest owner, not a deferred table.

**What remains LIVE_EXTERNAL_REQUIRED for 18-D specifically:** every drift
check reported by `infra-drift.yml` today would be `UNAVAILABLE`
(`credentials_not_configured`), correctly, since no AWS OIDC role or
remote-state backend exists yet (18-A). The scheduled workflow, the
classification logic, the alert bridge, and the ingestion route are all
real and tested; a live `NO_DRIFT`/`DRIFT_DETECTED` proof requires the
same live AWS account 18-A/18-B are waiting on.

### Security Gate 3 / Gate 6 relationship to this Phase 18 batch

Gate 6 (SQS IAM least privilege / worker message distrust) is NOT this
batch's scope — it was already closed by the prior audit (6R-C/12-D,
corrected in the gate table above) and this batch consumes those existing
IAM resources as-is via `infra/modules/iam/` rather than rebuilding them.
Gate 3 (network-level egress/VPC hardening) is also NOT this batch's
scope: no `aws_security_group`/NACL resource exists anywhere in this
repository's Terraform to harden, building one would mean inventing
VPC/subnet/CIDR topology nobody has decided, and doing so "merely to close
Phase 18" is explicitly the fabrication this batch was told to avoid.
Both remain correctly attributed to their own owners, unchanged.

### Regression (this batch)

Real `terraform fmt -check` (all three roots): PASS. Real `terraform
validate` (bootstrap, dev, production, all three independently
`init -backend=false`'d): PASS, PASS, PASS. Full suite: 1971/1974 pass —
the 2 known pre-existing Phase-8 `ModelSelector` pins (unrelated,
unmodified) plus the git-status-snapshot pin (clears on commit). `tsc
--noEmit`, `npm run build`, ESLint on every touched file, `secrets:scan`,
`telemetry:scan`: all clean. No Supabase migration. No locked product UI
touched.

### Not in this batch

Actually applying `infra/bootstrap/` or any environment root to a live AWS
account (needs real credentials and an account decision nobody has made);
configuring GitHub's `environment: production` required-reviewer rule
(live, external, one-time repository Settings action); importing the
hand-created production resources into Terraform state (needs the above
first); a dedicated Terraform-aware policy/security scanner (tfsec/
checkov — reasonable future addition, not required by this batch's own
"reuse existing scanners" instruction); Phase 19's OPA runtime (not
implemented, not needed here); Gate 3's network-level egress hardening
(remains `DEFERRED_EXTERNAL`/`BUSINESS_DECISION_REQUIRED`, VPC topology
undecided). **Phase 18 does not start Phase 19.**

## Phase 19 — Policy-as-Code & Automated Action Guardrails

**Authoritative roadmap source:**
`Cinefield_Master_Yol_Haritasi_v1.9.1_TEMIZ_MASTER_EK_F SON.docx` (local,
the same version already used for Phase 17). Roadmap status line: "Phase
19 — NOT_STARTED — FOUNDATION EXISTS... Phase 12-E default-deny Policy
Gate ve Phase 14 AI authority foundation'dır; tam OPA/Rego runtime
governance Phase 19'da." Four official packages, 19-A through 19-D:
19-A (OPA service/sidecar + standard decision contract, deterministic
across environments), 19-B (Rego test suite in CI), 19-C (wire AI
remediation / provider disable / admin sensitive action / deployment gate
to policy, add decision log), 19-D (fail-safe / TTL-reversible-idempotent
bounds / policy-change PR governance). The roadmap explicitly states a
second policy engine is not built — Phase 19 completes the Phase 12-E
gate's real runtime governance, it does not replace it.

### The real, pre-existing defect this batch found, before building anything

`policies/cinefield/policy.rego` and `policy_test.rego` referenced
`data.cinefield.actions.*` / `data.cinefield.conformance.*`. Real OPA does
not fold a JSON file's name into its data path — only its directory —
so `policies/data/actions.json` loads at `data.data`, and
`policies/conformance/cases.json` loads at `data.conformance`, never under
`data.cinefield`. This repository's own `opa test` had, in fact, never
been run against this tree before this batch (mirroring Phase 18's
Terraform discovery): the first real run was **8 of 9 tests FAILED**. The
`aiWriteAllowlist` Rego test was also stale — asserting the allowlist was
empty, when Phase 14-B had already, correctly, added `code.pr.create`
months earlier; this had also gone undetected because the suite never ran.

Fixed by adding `import data.data as action_registry` in `policy.rego`
and correcting every `data.cinefield.*` reference in both files to the
paths OPA actually resolves — the JSON files themselves were **not**
moved, since ~8 TypeScript call sites (`policy-engine.ts`'s ES import,
`change-risk.ts`'s risk classification, several Phase 14/16-C tests)
depend on their exact literal paths. `opa test`: 9/9 pass after the fix
(13/13 after 19-C's new conformance cases). `policies/README.md`'s own
data-path claim (`data.cinefield.actions`) was equally wrong and is
corrected in this batch too.

### 19-A / 19-B — real OPA tooling, for the first time

OPA 1.19.1 installed and run for real. `opa build -t wasm` compiles a real
WASM bundle (`policies/bundle/policy.tar.gz`, gitignored — CI rebuilds it
fresh from `policies/` rather than trusting a committed binary that could
drift from the Rego source). `npm run policy:wasm-parity`
(`scripts/policy-wasm-parity.ts`) extracts that bundle, loads it via
`@open-policy-agent/opa-wasm`, calls `policy.setData()` with the bundle's
own baked-in data document, and evaluates every one of the 49 conformance
cases through BOTH the compiled WASM and the real embedded
`evaluatePolicy()` — proving parity, not assuming it from a shared JSON
file. Result: `{"result":"parity_confirmed","totalCases":49,"pass":49,
"failures":[]}`. `.github/workflows/policy-ci.yml` (this repository's
second-ever CI workflow, after Phase 18's `infra-*.yml`) runs `opa test`,
`opa build -t wasm`, the parity script, the existing TS conformance suite,
and `tsc --noEmit` on every PR touching `policies/**` or
`src/lib/policy/**` / `src/lib/deployment/**` — it never runs `opa apply`
or `opa exec`; this is a verification gate, not a deploy step.

### 19-C — deployment gate wired to policy, additively

A new registry entry, `deployment.production.apply` (`critical: true`,
`requiredRoles: ["route_admin", "service"]`, `requiresHumanApproval:
true`, `owner: "phase-19"`), and a new composition wrapper,
`src/lib/deployment/deployment-policy-gate.ts`
(`evaluateDeploymentWithPolicy()`), following the exact precedent Phase
14-B's `ai-pr-authority.ts` already established for `code.pr.create`:
call `requirePolicy()`, catch `PolicyDenied`, never reimplement decision
logic. `deployment-guard.ts` (Phase 14-D) itself is untouched — the
wrapper composes both verdicts (`eligible` only when BOTH the existing
deployment-guard AND the policy layer independently allow) rather than
absorbing one into the other. The decision log requirement is met by
reuse: `requirePolicy()` already calls `reportPolicyDecision()` →
`security-signals.ts` → `security-event-logger.ts`'s existing
`record_security_event` RPC — no new table, no new migration.

### 19-D — fail-safe

A fault in policy evaluation that is not a `PolicyDenied` decision
(a real evaluator exception, a malformed bundle) propagates via `throw
caught` in the wrapper — it is never silently treated as an allow. The
underlying fail-closed behavior for a missing/invalid bundle, unknown
action, or malformed input was already proven by the Phase 12-E suite;
this batch adds no second path that could swallow a real fault. Policy
changes are gated: `policy-ci.yml` runs on every `policies/**` change and
blocks merge on `opa test` / parity / build failure.

### Engine-transition state — embedded remains sole runtime authority

`PolicyDecision.engine` is `"embedded"` everywhere in production, still.
The WASM path built and proven this batch is **CI-proof only** — it does
not run in any request path. `policy-gate.ts` does not import
`opa-wasm`/`loadPolicy` anywhere. This is a deliberate, conservative
reading of the roadmap's own instruction not to silently replace the
embedded engine without extensive parity proof, and of the Phase 16-E
lesson this brief explicitly cited: a shadow/parity mechanism must never
risk becoming fail-open. Standing up a live OPA sidecar/service (the
literal text of 19-A) was evaluated and deliberately not built — the
roadmap's own components table lists OPA as `Risk/Deploy/AI Ops`-scoped
central deterministic decision-making, and this batch's WASM-in-process
proof already satisfies "same input → deterministic decision across
dev/staging/prod" without a second network-dependent process a
fail-closed gate would then depend on staying alive. A live sidecar
remains a legitimate, larger future batch if the roadmap owner decides
scale requires it.

### Ownership boundaries preserved

Tier-0 admin authorization (`src/lib/admin/tier0-authorization.ts`,
Phase 16-E) is not modified or absorbed — it remains a genuinely separate
authorization dimension, not integrated into the policy layer this batch,
documented as a considered non-change. The AI write allowlist is
unchanged (`["code.pr.create"]`); the new `deployment.production.apply`
entry requires `route_admin`/`service`, never `ai_agent`, and is not
allowlisted for AI writes. A policy `ALLOW` means "may proceed to its
canonical owner" — Phase 7 routing, Phase 9 quarantine, Phase 15-D
redrive, Temporal cancel, BullMQ retry, and Phase 16 admin/Tier-0 actions
all keep executing through their own existing code, unchanged.

### Regression (this batch)

Full suite: 1994/1996 pass — the 2 known pre-existing Phase-8
`ModelSelector` pins (unrelated, unmodified). Three Phase-14 structural
pins (`S14A-25`, `S14B-32`, `S14E-9`) had asserted "no deploy-shaped
action exists in the registry at all" as a Phase-14-batch-scoped guard
against Phase 14 itself prematurely registering one; narrowed to the real,
still-valid invariant ("no deploy-shaped action is AI-allowlisted") now
that Phase 19 has legitimately registered one. `tsc --noEmit`, `npm run
build`, ESLint on every touched file, `secrets:scan`, `telemetry:scan`:
all clean. No Supabase migration. No locked product UI touched.

### Not in this batch

A live OPA sidecar/service (deliberately not built — see above); making
the WASM engine live production authority (deliberately deferred, same
reasoning); wiring AI remediation / provider disable / admin sensitive
actions to this policy call beyond what already calls `requirePolicy()`
today (`media.quarantine.*`, `routing.control.*`,
`security.temporary_block.apply`, `code.pr.create` — all pre-existing,
real callers; the 9 registry actions still `implemented: false` belong to
their own not-yet-built phases: data export/delete and retention/legal
hold to Phase 23, admin review resolution and secret rotation to Phase 16,
account suspension to Phase 12-D); a dedicated policy-change PR review
bot beyond the required CI check. **Phase 19 does not start Phase 20.**

## Phase 19 Closure Fix — 19-C real-path policy wiring + two-person reconciliation

An independent master closure audit (read-only) re-verified the batch
above and found the OPA/parity/fail-closed claims solid, but found 19-C's
wiring materially thinner than reported: `routing.control.set/clear` were
policy-gated but structurally unreachable from any real admin route
(`router-admin-service.ts` deliberately calls `setRouteEnabled` instead —
see its own header); the REAL, production-reachable route-disable path,
plus `queue.dlq.redrive` and `temporal.workflow.cancel`, went through
Tier-0 only and never through `requirePolicy()`; and the new
`deployment.production.apply` entry's `requiresTwoPerson: false`
contradicted the roadmap's own Two-Person Approval list (¶2344), which
names "provider enable/disable", "DLQ redrive", "Temporal workflow
cancel", and "deployment/rollback" explicitly. This batch closes those
three gaps.

### Real policy wiring, all three real paths

`requirePolicy()` (action `route.disable` / `queue.dlq.redrive` /
`temporal.workflow.cancel`) is now the unconditional first gate in
`router-admin-service.ts`'s `setAdminRouteEnabled`, `dlq-admin-service.ts`'s
`executeAdminDlqRedrive`, and `temporal-admin-service.ts`'s
`performAdminTemporalCancel` — matching the exact composition
`admin-route-service.ts`'s `routing.control.set/clear` already
established, and never replacing `setRouteEnabled`/the redrive
executor/`recordCancelIntent` themselves. A `PolicyDenied` is caught and
returned as a new `POLICY_DENIED` outcome on each contract; any other
thrown error propagates (fail-closed, never silently allowed). All three
actions are registered in `policies/data/actions.json`
(`requiredRoles: ["route_admin"]`, `requiresHumanApproval: false`,
`requiresTwoPerson: true`), are never AI-allowlisted, and an AI actor is
denied by `evaluatePolicy` before any role check runs.

### The missing half of Phase 16-E's own dual-control mechanism

`tier0-action-catalogue.ts` now sets `requiresTwoPerson: true` for all
three actions — activating a branch that already existed inside
`authorizeTier0Action` (`isTwoPersonSatisfied`, now `twoPersonStatus`) but
had never been reachable in practice: no code anywhere called
`record_admin_privileged_action_approval` (the Phase 16-E SQL RPC that
structurally blocks self-approval), so a `requiresTwoPerson` action would
have gone straight to `awaiting_second_approval` on a fresh, random
`requestId` every single attempt and could never actually be satisfied.
This batch closes that gap with:

- `decidePrivilegedAction` (`tier0-authorization.ts`) — the real, missing
  second caller. A second, distinct admin submits `approve`/`reject`
  against an EXISTING `requestId`, gated by the same role/step-up bar the
  original requester cleared. Approval calls the existing RPC unmodified;
  rejection reuses the plain append-only event writer (`event: "rejected"`
  — no RPC needed, no new migration).
- `POST /api/admin/privileged-actions/decide` — the one new admin route,
  same conventions as every other Phase 16 admin route
  (`requireAdminAccess`, `guardPrivilegedMutation` CSRF guard,
  `durable_write`, opaque 404 on denial). Never imports or calls a
  canonical action owner.
- The three admin-service functions now accept an optional `requestId` so
  a caller can RESUME a pending request after a second admin approves it,
  rather than minting a fresh, unsatisfiable one every attempt; the
  `TIER0_AUTHORIZATION_REQUIRED` outcome now carries that `requestId`.
- `authorizeTier0Action` no longer re-writes a fresh `'requested'` event
  on every retry of the SAME `requestId` — a real bug this batch found
  and fixed during its own test-writing: without this, a retry would
  silently renew the request's apparent age, making expiry unreachable in
  practice.
- Request-window expiry (`PRIVILEGED_ACTION_REQUEST_TTL_SECONDS = 900`,
  matching `step-up-auth.ts`'s `ELEVATED_SESSION_TTL_SECONDS` precedent)
  and rejection are both real, application-level, terminal states
  (`two_person_expired` / `two_person_rejected`), enforced against the
  existing `occurred_at` column — no schema change.
- **Approval bound to action + target** (an explicit closure-fix
  requirement): the Phase 16-E RPC validates the requester by `request_id`
  alone — it does not itself check that the action/target an approver
  names still matches what was originally requested. `decidePrivilegedAction`
  adds that check itself, refusing (`NO_MATCHING_REQUEST`) an approval or
  rejection whose action/target don't match the original `'requested'`
  event — a real, pre-existing binding gap this batch found and closed,
  reusing the same audit table, no RPC change.

`media.quarantine.release`'s own real, SQL-PK-enforced two-person
mechanism (Phase 9-E) is untouched — this batch does not duplicate it.
`routing.control.set/clear` remain `requiresTwoPerson: false`, unchanged:
still real, still policy-gated, still structurally unreachable from any
admin route, still `BUSINESS_DECISION_REQUIRED` per Phase 16-E's own
catalogue note — genuinely out of this batch's scope, since the roadmap's
Two-Person list names the REAL provider-disable path
(`route.disable`/`setRouteEnabled`), not this dormant one.

### Deployment two-person — contract corrected, ownership documented, nothing faked

`deployment.production.apply`'s `requiresTwoPerson` is now `true`,
correctly representing the roadmap's own list. It is **not** enforced
downstream the way the three actions above now are, because no real
application-level production-deploy EXECUTION path exists anywhere in
this repository for either mechanism to gate (`evaluateDeployment()`
itself, Phase 14-D, has never had a real caller either — deploys happen
outside this codebase, via Vercel/CI). Inventing a downstream two-person
check with nothing real to guard would be exactly the "fake
application-level execution" this batch was told not to do.
`deployment-policy-gate.ts`'s own header now documents the real owner,
when a real deploy-trigger path exists to gate: a GitHub
protected-environment required-reviewer rule (the same live-external
mechanism `infra-apply.yml`, Phase 18, already uses), a Phase 16-E durable
approval if the trigger is itself an in-repo admin action, or both — that
decision belongs to whoever builds the real trigger.

### Credit adjustment, user unblock, secret rotation — classified, not fabricated

None of these three roadmap-named Two-Person actions has a real
application owner/caller anywhere in this repository today (confirmed by
exhaustive grep — no credit-adjustment mutation, no account-unblock
mutation exists). `secret.rotate` and `account.suspend` were already
correctly registered `implemented: false` (owners: Phase 12-D and Phase
16 respectively) before this batch; no credit-adjustment action is
registered at all, since inventing one merely to populate a checklist
would be exactly the "fabricate endpoints" this batch was told not to do.
All three are classified `NOT_REACHABLE` / `FUTURE_OWNER` — real,
disclosed gaps for their respective future phases, not silently dropped.

### Regression (this batch)

Full suite: 2023/2026 pass — the 2 known pre-existing Phase-8
`ModelSelector` pins (unrelated, unmodified) plus the git-status-dirty pin
(clears on commit). A real bug was found and fixed DURING this batch's own
test-writing (`authorizeTier0Action`'s duplicate-`'requested'`-event-on-retry
defect above) — proof the new two-person test coverage exercises the real
mechanism rather than a mock of it. `tsc --noEmit`, `npm run build`,
ESLint on every touched file, `secrets:scan`, `telemetry:scan`: all clean.
No Supabase migration. No locked product UI touched.

### Not in this batch

`routing.control.set/clear`'s admin-UI reachability (still
`BUSINESS_DECISION_REQUIRED`, unchanged from Phase 16-E); a live
application-level deploy-trigger for `deployment.production.apply` (none
exists to build against); expiry/rejection at the SQL/RPC layer (both
implemented in application code against the existing `occurred_at`
column instead, deliberately avoiding a migration this batch was not
asked to add); a UI for `POST /api/admin/privileged-actions/decide` (the
route is real and functions correctly against a manually-shared
`requestId`; an admin-panel affordance for it is a reasonable future
slice, not required to close this gap). **This closure-fix batch does not
start Phase 20.**

## Phase 20 — API & Event Contract / Schema Governance

**Authoritative roadmap source:** `Cinefield_Master_Yol_Haritasi_v1.9.1_TEMIZ_MASTER_EK_F SON.docx`
(the same version already authoritative for Phases 17/19). Official title:
"Phase 20 — API & Event Contract / Schema Governance." Roadmap status line:
"NOT_STARTED — FOUNDATION EXISTS. Outbox/event schema, UserIntent/
GenerationManifest ve command contracts foundation sağlar; governance/
sürümleme Phase 20'de." Four official packages, 20-A through 20-D:
20-A (event envelope/version standard + AWS Glue Schema Registry domain
schema set), 20-B (producer validation + consumer SerDe/compatibility),
20-C (OpenAPI source-of-truth + generated TypeScript types/client
pipeline), 20-D (Kafka schema compatibility + HTTP contract CI gate).

### The reality audit found far more foundation than "FOUNDATION_EXISTS" implied

20-A and 20-B are not merely foundational — they are essentially
**already complete, real, and exhaustively tested**, predating this batch
under Phase 6R.15:

- `src/lib/events/domain-event.ts` — the envelope standard itself
  (`eventId`/`eventType`/`eventVersion`/`aggregateType`/`aggregateId`/
  `occurredAt`/`traceId`/`payload`), with `buildDomainEvent()` enforcing
  every field, JSON-plain payload, and a 64KB size ceiling.
- `src/lib/events/event-schemas.ts` — the domain schema SET (13 registered
  event payloads across the generation/provider/credit/asset/security
  families — "GROUNDED, NOT INVENTED" per its own header: events for
  concepts that don't exist yet are deliberately absent, not fabricated).
- `src/lib/events/schema-registry.ts` — `validateDomainEvent()` (producer
  validation, called from `kafka-producer.ts` before every publish) and
  `classifyCompatibility()`, a real, already-tested implementation of
  exactly the backward-compatibility policy the roadmap describes
  conceptually (additive/widening = no bump; removal/narrowing/new-required
  = bump required).
- `src/lib/events/event-consumer.ts` — `inspectInboundEvent()` is the
  consumer-side SerDe/compatibility check: parses, validates against the
  same registry, and routes a schema violation to reject/DLQ rather than
  an infinite redelivery loop.
- `src/lib/events/glue-schema-registry.ts` / `schema-registry-config.ts` —
  Glue integration exists as a real, honestly-disabled stub
  (`syncSchemasToGlue()` always returns `disabled`/`unconfigured`/
  `unavailable`, never a fake `ready`; `@aws-sdk/client-glue` is
  deliberately not installed) — consistent with the roadmap's own note
  that Kafka/MSK is "activation-ready... not provisioned before a scale
  signal arrives."
- `src/test/e2e/phase-11a-event-contract-guard.e2e.test.ts` — ties SQL
  event emission to the TypeScript contract, catching the exact class of
  defect ("SQL emits an event type TypeScript refuses") that shipped
  undetected once before (9-E's `media.asset.released`).

None of this was reinvented. What this batch verified was real and left
unmodified except one additive change: `ENVELOPE_SCHEMA` in
`schema-registry.ts` gained an `export` keyword so the new OpenAPI
generator could reuse the exact runtime-enforced shape instead of
declaring a second copy.

### 20-C — OpenAPI + generated TypeScript types, honestly scoped

Genuinely missing before this batch (confirmed: zero `.yaml`/`.json`
OpenAPI files anywhere in the repo, zero `zod`/`json-schema`/`openapi`
dependencies). Built:

- `openapi/cinefield.json` (generated, `npm run contracts:generate-openapi`) —
  `components.schemas` is DERIVED from `EVENT_SCHEMAS` and
  `ENVELOPE_SCHEMA` (14 schemas: the envelope + all 13 real registered
  events), never a hand-written duplicate. Cinefield's internal
  `JsonSchema` subset (json-schema.ts) already IS valid OpenAPI 3.1 (which
  is JSON Schema 2020-12), so the generator copies rather than converts.
  `paths` covers exactly two real, field-by-field-verified routes
  (`GET /api/health/live`, `POST /api/admin/privileged-actions/decide`) —
  a deliberately small, honest subset, not a claim of full API coverage.
  Cinefield has roughly 40 HTTP routes; extending coverage is additive,
  incremental future work.
- `src/lib/contracts/generated/api-types.ts` (generated, `npm run
  contracts:generate-types`, via `openapi-typescript` — MIT-licensed, pure
  local codegen, no network call, no paid service) — real TypeScript types
  produced FROM the OpenAPI document, satisfying "API tipleri şemadan
  otomatik üretiliyor" for the routes/events it covers. Marked
  "GENERATED — DO NOT EDIT BY HAND"; `contract-ci.yml` regenerates and
  diffs to catch manual edits or a stale artifact.
- Both generation steps are verified deterministic: re-running produces a
  byte-identical file (checked this batch by diffing a fresh run against
  the committed output — zero difference).

### 20-D — breaking-change detection and CI gate, real and independently proven

`scripts/check-contract-compatibility.ts` — for every `eventType@eventVersion`
key present in BOTH a base git ref (default `origin/main`, overridable via
`CONTRACT_BASE_REF`) and the current tree, reuses the EXISTING
`classifyCompatibility()` (no second compatibility rule) to detect an
already-published version's schema being mutated incompatibly in place —
the exact silent breaking change 20-D exists to block. A brand-new version
key is never flagged (that is the correct way to make an incompatible
change). Reads the base revision via `git show <ref>:<path>` only — no
GitHub API, no network beyond git itself.

**Proven working, not just written:** this batch temporarily injected a
real breaking change into `event-schemas.ts` (`asset.released@1` gained a
new required field), ran the script, confirmed a real non-zero exit and
the exact finding reported, then reverted the injection (`git diff`
confirmed byte-identical to before). Re-run afterward: clean, exit 0.

`.github/workflows/contract-ci.yml` (this repository's third contract/
governance-focused CI workflow, after `policy-ci.yml` and the `infra-*.yml`
trio) runs, on every PR touching `src/lib/events/**`, `src/lib/contracts/**`,
`openapi/**`, or the generator scripts: the compatibility check against the
real PR base ref, `npm run contracts:generate` followed by
`git diff --exit-code` (drift detection), the real Phase 6R.15 event/
schema-registry test suite, the Phase 11-A SQL↔TypeScript contract guard,
and `tsc --noEmit`. Never applies, publishes, or mutates production state.

### Ownership preserved

Phase 17's `GenerationManifest`/`manifestVersion`/`compilerVersion`
contract (already real, already dual-versioned, already following the
same `policy_version`-derived convention this batch's own governance
reuses) is untouched — Phase 20 governs contracts, it does not redesign
Phase 17 semantics. Phase 19's policy registry, Rego, and CI workflow are
untouched (diffs confirmed empty). No second policy engine, no second
admin authorization layer, no second AI authority, no second deployment
owner was created. The event schema registry remains the ONE domain
schema source of truth; OpenAPI is generated FROM it, never a competing
definition.

### Regression (this batch)

Full suite + event-schema unit tests: 2088/2090 pass — the 2 known
pre-existing Phase-8 `ModelSelector` pins (unrelated, unmodified).
`tsc --noEmit`, `npm run build`, ESLint on every touched file,
`secrets:scan`, `telemetry:scan`: all clean. No Supabase migration — the
contract registry stays source-controlled TypeScript, per the roadmap's
own "prefer no new paid service"/"no DB table by default" instruction. No
locked product UI touched.

### Not in this batch

Live AWS Glue Schema Registry / MSK provisioning (deliberately deferred —
"Kafka/MSK... not provisioned before a scale signal arrives," same
reasoning already established for Phase 18's infrastructure and Phase
19's OPA sidecar); OpenAPI coverage of the ~38 remaining HTTP routes
(incremental, honestly disclosed as partial rather than fabricated as
complete); making `contract-ci.yml` a GitHub-required status check (a
live, external, one-time repository Settings action, same category as
every other CI workflow this repository has shipped); a generated
TypeScript CLIENT (only types are generated — an actual fetch-wrapper
client was not requested by this batch's own scope and would be
incremental work on top of the types that now exist). **Phase 20 does not
start Phase 21.**

### Phase 20 corrective batch — event tenant context + HTTP breaking-change detection

The closure audit found two real gaps the batch above left open: the
envelope had no tenant/workspace field despite the roadmap naming one, and
20-D only ever covered Kafka event schemas — an HTTP path/shape could be
removed or narrowed with nothing catching it. Both are now closed.

**Canonical wire field: `tenantId`.** Chosen over `workspaceId` on a
15-vs-4 file terminology audit across the codebase (Clerk's own `sub`
claim, `profiles.clerk_user_id`, and every existing per-user scoping
already say "tenant", not "workspace"; nothing user-facing uses
"workspace" as an isolation boundary today). Added as `tenantId?: string`
to `DomainEventEnvelope` (`domain-event.ts`) and to `ENVELOPE_SCHEMA`
(`schema-registry.ts`) as an OPTIONAL property, never `required` — an
old-style envelope with no tenant is exactly as valid as before, so no
version bump was needed anywhere in `event-schemas.ts`.

**Real producer threading, not a decorative field.** The actual gap was
`claim_outbox_events()`: `outbox_events.tenant_id` (added Phase 20's own
`20260824000000_event_contract_and_tenant_routing.sql`, captured
automatically at write time inside `emit_outbox_event` from the
aggregate) was never SELECTed by the claim function, so it never reached
the TypeScript layer or the Kafka-bound envelope even though the column
existed. `supabase/migrations/20260830000000_outbox_claim_tenant_id.sql`
adds `tenant_id text` to `claim_outbox_events()`'s output — via
`DROP FUNCTION` + `CREATE FUNCTION` (Postgres refuses `CREATE OR REPLACE`
across a changed `RETURNS TABLE` column set), with
`ALTER FUNCTION OWNER TO`/`REVOKE`/`GRANT EXECUTE` re-stated since `DROP`
removes prior grants. The write side (`emit_outbox_event`) is untouched —
its own migration header already documents that a caller-supplied tenant
parameter was tried once and reverted (two ways to supply a tenant is two
ways to supply the wrong one), so the fix only widens the READ side.
`outbox-repository.ts` gained an exported pure `outboxRowToEnvelope()`
mapping the new column onto `event.tenantId` (absent on the row means
absent on the envelope, never guessed or defaulted); `kafka-producer.ts`
carries it onto the wire as a `tenant-id` Kafka message header, the same
place `traceId` already travels. The full real path is now: `outbox_events
.tenant_id → claim_outbox_events() → outboxRowToEnvelope() →
DomainEventEnvelope.tenantId → publishDomainEvent() → Kafka header`.

**Bounded routing/correlation evidence only** — the same discipline
`traceId` already follows. `tenantId` is never read as auth, billing, or
project-ownership authority anywhere in the events/kafka/outbox modules
(checked this batch); Supabase RLS, Clerk `auth()`, and the credit RPCs
remain the only real authorities for those concerns, completely
unmodified.

**20-D extended to HTTP: `scripts/check-openapi-compatibility.ts`.** A
narrow structural checker for exactly the OpenAPI subset
`generate-openapi.ts` emits (inline `paths[path][method]` request/response
schemas plus `components.schemas`, no `$ref`/`allOf`) — not a generic
OpenAPI diff engine. Reuses the SAME `classifyCompatibility()` the event
checker already uses, in both directions (request-shape narrowing breaks
old callers; response-shape narrowing breaks old consumers). Reads the
base ref via the identical `git show <ref>:<path>` / `CONTRACT_BASE_REF`
model `check-contract-compatibility.ts` already established — one
baseline store, not two. Flags `PATH_REMOVED`, `METHOD_REMOVED`,
`REQUEST_BODY_REMOVED`, `REQUEST_NARROWED`, `RESPONSE_REMOVED`,
`RESPONSE_NARROWED`, `SCHEMA_REMOVED`; a new path, new method, new schema,
or optional-field addition is structurally never visited by the
removal/narrowing loops (they iterate the BASE document's keys looking
for absence in the current one), so none of those can ever be flagged.

**Proven working, not just written** — this batch injected and reverted,
against the real committed `openapi/cinefield.json` on `origin/main`:
(A) removed `/api/admin/privileged-actions/decide` entirely → `PATH_REMOVED`,
exit 1; (B) removed its `POST` method → `METHOD_REMOVED`, exit 1;
(C) moved its optional `targetId` request field into `required` →
`REQUEST_NARROWED: ... targetId: became required`, exit 1; (D) removed its
`satisfied` response field → `RESPONSE_NARROWED: ... satisfied: removed`,
exit 1. Then, separately, injected three compatible changes in one batch —
a brand-new `/api/health/ready` path, a new optional request field, a new
optional response field — and confirmed exit 0, no finding. All injections
reverted; `git diff` against the committed file showed only the legitimate
`tenantId` addition from regeneration, nothing left over. Both compatibility
scripts were also proven to return `NOT_CONFIGURED` (exit 2, not a silent
pass) when pointed at a base ref that does not exist.

**CI wiring.** `contract-ci.yml` gained a fifth step,
`npm run contracts:check-openapi-compat`, using the identical
`CONTRACT_BASE_REF` env var the event-schema step already sets (one
env-var name appears exactly twice in the workflow — one baseline model).
No `continue-on-error` anywhere in the file. `paths:` trigger extended to
include the new script.

**Regression (this batch).** The Phase 20 contract-governance suite plus
the event/schema-registry/outbox unit suites: 101/101 pass (8 new unit
tests across `domain-event.test.ts`/`schema-registry.test.ts`, 11 new
structural/behavioral tests in `phase-20-contract-governance.e2e.test.ts`).
Full regression: 2267/2327 pass; every one of the 60 failures was
independently attributed to one of four causes, none a code regression
from this batch: 53 are the pre-existing Windows
`Failed to start ephemeral server: Zugriff verweigert (os error 5)`
Temporal test-server environment failure (present identically on this
machine before this batch — classified `ENVIRONMENT_FAILURE` per explicit
instruction, application code was not touched to hide it); 3 are OTHER
phases' own blunt `git status --short -- supabase/` migration-guard tests
(`phase-13-health-foundation`, `phase-14b-ai-pr-safety`,
`phase-15a-slo-error-budget`) spuriously failing only because this batch's
own new, not-yet-committed migration file was sitting in the working tree
at test-run time — self-resolving the moment it is committed, not a defect
in this batch's own code; 2 are the same pre-existing Phase-8
`ModelSelector` pin mismatches already known and unmodified from the
original Phase 20 batch; 2 are a pre-existing, unrelated `iac-contract.test.ts`
assertion about `infra/README.md` wording that neither this batch nor its
files touch. `tsc --noEmit`, `npm run build`, ESLint on every touched file,
`secrets:scan`, `telemetry:scan`: all clean — the one pre-existing
`require()`-style-import lint error in `schema-registry.test.ts` sits
outside every line this batch added or touched.

**Not in this batch.** OpenAPI coverage of routes beyond the original two;
a live GitHub branch-protection "required" setting for `contract-ci.yml`
(unchanged deferred external action). **Phase 20 does not start Phase 21.**

## Phase 21 — Runtime Feature Flags, Kill Switches & Safe Rollout

**Authoritative roadmap source:** the same master DOCX already authoritative
for Phases 17/19/20. Official title: "Phase 21 — Runtime Feature Flags,
Kill Switches & Safe Rollout." Framing: "Phase 14-F remediation kill
switch, Phase 7 provider circuit-breaker/kill-switch ve spend controls
genel runtime feature flag/safe rollout sisteminin foundation'ıdır" — Phase
21's job is to GENERALIZE what Phase 7/14-F already pioneered, never to
re-implement it. Four official packages: 21-A (OpenFeature + LaunchDarkly
dev/staging/prod integration), 21-B (critical flag set + Admin screen),
21-C (audit + actor/reason/ticket/expiry + rollback metadata), 21-D
(router health/canary/percentage rollout + SLO guardrails + MCP write
approval/scope limit).

### What already existed, and why none of it was reused as a NEW flag target

A repository-wide reality audit (before any code was written) found real,
narrower flag mechanisms already owned elsewhere: `src/lib/routing/
circuit-breaker.ts` (Phase 7-C, a pure OPEN/HALF_OPEN/CLOSED state
machine), `src/lib/routing/runtime-flags.ts` + `src/lib/redis/
routing-control-store.ts` (Phase 7-E, a Redis A, TTL-bounded, policy-gated
`RuntimeControl` for one provider/model/route/provider-model target), and
`src/lib/deployment/remediation-guardrail.ts` (Phase 14-F, a single
env-var-only `CINEFIELD_AUTO_REMEDIATION_ENABLED` kill switch, deliberately
without a runtime setter). All three explicitly name Phase 21 as the
generalization owner in their own file headers, and `runtime-flags.ts`
already ships the exact seam this batch needed
(`RuntimeFlagSource` — "so a real OpenFeature or LaunchDarkly client can be
attached later without the router changing at all"). This batch registers
NO provider/model/route flag — `src/lib/routing/**` and
`src/lib/redis/routing-control-store.ts` are untouched by this phase (a
structural test proves it), and reading provider/model/route state through
the new generic evaluation core remains a real, available, UNTAKEN option
rather than a gap: wiring it risks coupling a new module into Phase 7's
live routing hot path for a done-criterion ("critical system killable
without a deploy") Phase 7's own admin UI already satisfies.

### 21-A — a vendor-neutral core, deliberately without the SDK dependency

`src/test/e2e/phase-7e-runtime-flags.e2e.test.ts` ("no flag SDK credential
exists and none is invented") already asserted, before this batch existed,
that `package.json` contains neither `launchdarkly` nor `openfeature`, with
the stated reason "the contract is an interface a real one can implement."
`src/lib/feature-flags/flag-contract.ts` is that interface: `FlagProvider`,
`FlagEvaluationContext`, `FlagEvaluationDetails` mirror OpenFeature's own
shape as Cinefield's OWN types, no dependency installed. LaunchDarkly is
therefore `BUSINESS_DECISION_REQUIRED`/`LIVE_DEFERRED` — a real backend
service with cost, and this repository's established pattern (AWS Glue in
Phase 20, an OPA sidecar in Phase 19) is to build the vendor-neutral seam
honestly and defer the paid backend, not to fabricate a live connection.
`src/lib/feature-flags/flag-store.ts`'s `LocalSupabaseFlagProvider` is the
one real, live implementer today — `evaluateFlag()`'s 21-A done-criterion
("server flag evaluation kontrollü çalışıyor") is satisfied by a real,
durable, policy-gated Supabase-backed evaluator, not a stub.

### 21-B — the critical flag set, registered narrowly

Four flags, in `src/lib/feature-flags/flag-registry.ts`:
`maintenance_mode` and `release_stage` (`alpha`/`beta`/`public`) are
`HIGH_RISK_TIER0`; `feature.video.enabled` and `uploads.enabled` are
`OPERATOR_MUTATION` — the SAME asymmetry Phase 9-E's own
request/reject-vs-release split already established in this codebase (the
kill direction stays fast and single-admin; the highest-blast-radius flags
get step-up). `release_stage` specifically implements the roadmap's own
cross-reference: "RELEASE_STAGE... Değeri public'e çeviren kod yolu Phase
19 policy kontrolünden geçer" (moving it to "public" goes through Phase 19
policy) — this is the single server-side value this document's own 12-gate
table (top of this file) has always implicitly needed and never had; moving
it to `"public"` uses a DEDICATED policy action
(`release_stage.activate_public`, two-person-enforced) distinct from every
other flag change, matching "public aşamasına geçiş pratikte... GERÇEK
PARA EŞİĞİ" — real Stripe live keys, open signup, no Cloudflare Access
wall — being the single highest-consequence flip this whole system can
make.

**Reused, never duplicated:** `src/lib/admin/feature-flag-admin-service.ts`
calls `requirePolicy()` then `authorizeTier0Action()`, in that order,
before any write — the identical composition `router-admin-service.ts`'s
`setAdminRouteEnabled` already established for `route.disable`. Three new
actions registered in BOTH `policies/data/actions.json` and
`tier0-action-catalogue.ts`, in lockstep: `flag.set.operator`,
`flag.set.tier0`, `release_stage.activate_public` — the last one
`requiresTwoPerson: true` in both registries, activating the SAME generic
dual-control mechanism (`admin_privileged_action_events`,
20260829000000) `route.disable`/`queue.dlq.redrive`/
`temporal.workflow.cancel` already use. `policies/cinefield/policy.rego`
needed NO changes at all — it is fully data-driven over
`policies/data/actions.json`, confirmed by `opa test policies/ -v`
(13/13 pass, including 7 new Phase 21 conformance cases). `policyVersion`
bumped `2026-08-14.1` → `2026-08-19.1`.

`/admin/feature-flags` (page + `FeatureFlagsPanel.tsx`) and
`GET /api/admin/feature-flags` / `POST /api/admin/feature-flags/set` match
`/admin/router`'s established 8-layer stack exactly: layout-level
`requireAdminAccess()`, route-level `requireAdminAccess()` (opaque 404 on
denial), `guardPrivilegedMutation` (CSRF/origin), `guardRoute` rate limit,
policy, Tier-0 role/step-up/two-person, execute, `recordTier0Execution`
audit close-out. A new nav link, not a second "Router Controls."

### 21-C — durable, append-only audit with rollback and lazy expiry

New migration `20260901000000_feature_flags.sql`: `feature_flags` (current
value per flag) + `feature_flag_audit` (append-only history, an
UPDATE/DELETE trigger refuses — the same pattern
`admin_privileged_action_events_append_only()` already established).
`set_feature_flag()` (SECURITY DEFINER) writes both in ONE transaction,
mirroring `emit_outbox_event()`'s own reasoning for why PostgREST cannot
do this safely across two HTTP requests — and captures the pre-change value
as the new `rollback_value` automatically when the caller does not supply
one. This is a genuinely new table, not a reuse of
`admin_privileged_action_events` (20260829000000, Phase 16) — that table
already records, for free, WHO authorized a `flag.set.*` action and WHEN,
but has no `value`/`rollback_value` columns and is not meant to; the two
tables are complementary, the same relationship `model_routes.enabled` (the
real state) already has with that same authorization table for
`route.disable`.

**Expiry is lazy, not scheduled.** `flag-store.ts`'s `effectiveRecord()`
treats a flag whose `expiresAt` has passed as equal to its own
`rollbackValue` on READ — never a background writer — the same
"computed lazily from elapsed time" discipline
`src/lib/routing/circuit-breaker.ts`'s OPEN→HALF_OPEN transition already
uses. No `schedules.task()` exists anywhere in this repository (confirmed:
`src/trigger/operational/operational-tasks.ts`'s own header states every
task here is `task()`, never `schedules.task()`) to drive a real scheduled
revert, and this batch does not invent one.

### 21-D — canary guardrail: a real, tested decision layer, honestly scoped

`src/lib/feature-flags/canary-guardrail.ts`'s `evaluateCanaryGuardrail()`
is a PURE function — no Supabase, no Redis, no flag write — over Phase
15-A's own `computeErrorBudget()` output (`src/lib/slo/error-budget.ts`),
never a second SLO signal type. This is the same honest shape
`src/lib/finops/cost-guard.ts` (Phase 15-B) already established in this
codebase: a real, tested recommendation/decision layer with **no automated
caller** — this repository has no `schedules.task()` anywhere to invoke
anything unattended, so "Regression rollout'u otomatik geri alıyor" (21-D's
own done-criterion, "automatically") cannot be honestly claimed as live
today. Wiring a real Trigger.dev cron is `LIVE_DEFERRED` — new scheduled
infrastructure, out of this batch's own authorization. Equally, no
percentage-rollout-shaped flag was added to `flag-registry.ts`: all four
Phase 21-owned flags are binary/enum kill switches, and Cinefield has no
gradual-rollout product surface today to attach one to — inventing one
would be exactly the fabricated future product surface this batch's own
scope forbids.

### Contract governance (Phase 20) composed, not duplicated

One new domain event: `audit.flag-changed@1`, registered in
`event-schemas.ts` reusing the EXISTING `audit` family/topic (already
defined since Phase 6R.9, never previously populated) — no new family, no
new topic. Payload carries only bounded, stringified scalars
(`flagKey`, `riskTier`, `newValue`, `previousValue`) — never
`reason_code`/`ticket_ref` operator free text. Emitted best-effort, AFTER
the durable write and its audit row already committed — a failure here
never changes what the admin mutation reports. Regenerating
`openapi/cinefield.json`/`api-types.ts` for this new schema exposed a real,
narrow gap in Phase 20's OWN generator: `scripts/generate-openapi.ts`'s
`schemaComponentName()` didn't split a hyphenated event-type segment (this
event type is `audit.flag-changed`, and `EVENT_TYPE_PATTERN` has always
allowed a hyphen inside a segment), so it produced
`AuditFlag-changedPayloadV1` — a string openapi-typescript could only emit
as a quoted key, not a bare TypeScript identifier. Fixed in
`generate-openapi.ts` (split on `-` too, matching how it already splits
on `.`) — a narrow, targeted correctness fix this phase's own new event
exposed, not a redesign.

### Ownership preserved

`PHASE_17_OWNER_PRESERVED`, `PHASE_19_OWNER_PRESERVED`,
`TEMPORAL_OWNER_PRESERVED`, `ROUTER_OWNER_PRESERVED`,
`PROVIDER_ADAPTER_OWNER_PRESERVED`, `BILLING_OWNER_PRESERVED`: all YES — a
repository-wide grep of this batch's own diff for
`startGenerationWorkflow|opa\.|creditWallet|settleCredit|reserveCredit|routeDecision|ProviderAdapter|temporal\.client|GenerationManifest`
returns zero matches. No second policy engine, no second Tier-0 authority,
no second contract registry.

### Not in this batch

LaunchDarkly (or any) live flag-vendor account/API key —
`BUSINESS_DECISION_REQUIRED`. A live Trigger.dev `schedules.task()` driving
the canary guardrail unattended — `LIVE_DEFERRED`, new scheduled
infrastructure. Migrating Phase 7's provider/model/route kill switches or
Phase 14-F's auto-remediation kill switch onto this new flag layer —
available, real, deliberately UNTAKEN options, not gaps (Phase 14-F's own
header frames its missing runtime setter as an intentional safety property;
relaxing it is a real security tradeoff, not this batch's unilateral call).
A percentage-rollout flag TYPE — no real gradual-rollout product surface
exists to justify one yet. MCP write scope-limiting for a live MCP
transport — no MCP server exists anywhere in this repository (confirmed:
`docs/architecture/IMPLEMENTATION_ROADMAP.md`'s own line on this); the
policy composition point (`requireAiWritePolicy`/`aiWriteAllowlist`, which
already denies `flag.set.*` for any `ai_agent` actor) is real and ready,
with no transport to attach it to. **Phase 21 does not start Phase 22.**

## Phase 22 — AI Model Evaluation & Quality Governance

**Authoritative roadmap source:** the same master DOCX already authoritative
for Phases 17/19/20/21. Official title: "Phase 22 — AI Model Evaluation &
Quality Governance." Framing: "Phase 7 Router'ın quality/health/cost
sinyalleri burada eval setleri, quality thresholds, regression governance
ve model/version karar kanıtlarıyla derinleşir" — this phase deepens Phase
7's Router with real output-quality evidence, it does not replace any of
Phase 7's own routing logic. Four official packages: 22-A (`model_eval`
tables + Braintrust project + golden-dataset foundation), 22-B (multimodal
scorer set + model/provider/prompt version metadata), 22-C (wire offline
eval into a CI regression gate), 22-D (online sample/feedback loop + Admin
Model Quality dashboard + router `quality_score`/`confidence`
integration).

### The seam this phase fills already existed, fully built, permanently returning null

A repository-wide reality audit (before any code was written) found that
Phase 7-D already ships the ENTIRE consumption side of this phase's own
signal: `src/lib/routing/health-aware-router.ts`'s production entry point,
`resolveHealthyRoute()`, already takes a `qualitySource: QualitySignalProvider`
parameter; `src/lib/routing/route-scoring.ts`'s `scoreRouteComposite()`
already has a `quality: 0.25` weight wired into its composite score;
`src/lib/routing/route-quality.ts` already defines the full
`QualitySignal`/`RouteQuality`/`QualityPolicy` contract, with its own header
stating plainly: "Phase 22 will implement this against its evaluation
store... the production implementation below returns null for everything."
Its `NO_TRUSTED_QUALITY_SOURCE` provider, `DEFAULT_QUALITY_POLICY`'s empty
`trustedEvaluators` allowlist, and `src/test/e2e/phase-7d-cost-quality-routing.e2e.test.ts`'s
own hard assertions (`"the trusted-evaluator allowlist must start empty"`,
using the fixture name `"cinefield-eval"` — the exact evaluator name this
batch uses) were all written in an earlier phase, anticipating this one.
**Phase 22's job was narrower than reinventing router scoring: implement
the one interface Phase 7-D already declared, and decide — separately,
explicitly — whether to trust it.**

### 22-A/B — a real, durable eval store; source-controlled golden dataset

New migration `20260908000000_model_eval.sql`: `model_eval_runs` (one row
per measurement of one model version against one golden-dataset set,
immutable identity, a one-way `running`→`completed`/`failed` transition
enforced by `complete_model_eval_run()`'s own `WHERE status = 'running'`
predicate rather than an append-only trigger, since a trigger would also
forbid that one legitimate transition) + `model_eval_results` (append-only,
same `..._append_only()` trigger pattern `feature_flag_audit`/
`admin_privileged_action_events` already established). 22-A's own
done-criterion — "the first model/provider experiment record is created
with immutable metadata" — is satisfied by a real, durable
`model_eval_runs` row, provable end-to-end (`npm run eval:run`, using a
declared-synthetic producer — see below).

The golden dataset itself (`src/lib/eval/golden-dataset.ts`, 7 synthetic
cases across image/video/audio) is deliberately NOT a database table,
despite the roadmap's own "Nasıl yapılacak" step literally naming
`model_eval_sets`/`cases` tables — a disclosed, reasoned deviation: the
roadmap's own "temsilî prompt/reference/criteria setleri" instruction and
this project's standing "no DB table by default, prefer reviewable
fixtures" discipline are both better served by a source-controlled
TypeScript module (a case change is a normal PR diff) than a migration or
an admin-mutable table would be. `model_eval_runs`/`results` reference a
case only by its `caseKey` string.

Seven scorer dimensions (`src/lib/eval/scorers/`): `failure`, `latency`,
`cost`, and `safety` are fully real and computable today, reusing existing
evidence verbatim — `cost-scorer.ts` imports Phase 15-B's own
`CostObservation` type, never redeclaring it; `safety-scorer.ts` imports
Phase 9-E's own `ModerationResult` type, same discipline. `adherence`,
`quality`, and `consistency` require judgment no deterministic check can
honestly provide, so they go through a NEW, narrow seam of their own
(`src/lib/eval/scorers/judge-provider.ts`'s `AiJudgeProvider`/
`NO_JUDGE_AVAILABLE`) — mirroring `QualitySignalProvider`/
`NO_TRUSTED_QUALITY_SOURCE`'s exact shape: a bounded `{score, reasonCode}`
verdict, no field for chain-of-thought, and the honest `null`/
`"no_judge_configured"` answer until a real, live, paid judge model is a
deliberate future decision — never fabricated here.

### 22-C — a real, fail-closed regression gate; the live-generation line held

`scripts/check-model-eval-regression.ts` reads the candidate's and
baseline's `latestCompletedRun()` and refuses to pass — `NOT_CONFIGURED`
(exit 2) for missing required env vars (including
`MODEL_EVAL_REGRESSION_THRESHOLD`, which has NO invented default; the
roadmap names no specific tolerance number, so none is assumed) or a
missing baseline; `NO_EVIDENCE` (exit 1) for a candidate with no completed
eval run — proven live, this batch, against this repository's own real
Supabase connection: all three NOT_CONFIGURED paths reproduced with real
exit codes and messages. The script does NOT itself call a real provider —
see its own header for why running real generations against real providers
automatically inside a CI job (spending real money on every PR touching
routing) is exactly the "never trigger paid generation without explicit
authorization" line this whole project holds everywhere else. Populating a
candidate's real eval run (`npm run eval:run`, or a real
`ProduceOutputFn` wired to an actual `ProviderAdapter`) is a deliberate,
separately-authorized action a human takes.

`.github/workflows/eval-ci.yml` runs this gate on `workflow_dispatch` — an
HONEST, disclosed gap from `contract-ci.yml`/`policy-ci.yml`'s fully
automatic on-every-PR pattern: no automated "which `model_routes` row
changed" extraction from a migration diff exists yet in this repository, so
this cannot honestly be a fully automatic required check the way those two
are. The workflow says so in its own header rather than pretending
otherwise, and is deliberately `workflow_dispatch`-only for now, the same
pattern `infra-apply.yml` already uses for its own highest-consequence
action.

### 22-D — the router seam filled in, safely, before any trust decision is made

`src/lib/eval/eval-quality-provider.ts`'s `DurableEvalQualityProvider`
implements `QualitySignalProvider` for real, reading `model_eval_results`
via `qualitySignalFor()`. It is wired into the REAL production call site —
`src/lib/orchestration/generation-create-service.ts`'s `resolveHealthyRoute()`
call now passes `new DurableEvalQualityProvider(admin)` instead of relying
on the implicit `NO_TRUSTED_QUALITY_SOURCE` default. This is a genuinely
live change to the production generation-creation path, made safely: this
batch does **not** touch `DEFAULT_QUALITY_POLICY.trustedEvaluators` (still
`[]`, still hard-asserted by the pre-existing Phase 7-D test), so every
signal this provider returns is still discarded as `"unknown"` by
`normalizeQuality()` and scores a neutral `1` — proven unchanged by
re-running the full Phase 7/7-D/7-E/8 regression suite (173/175 pass, the
2 failures the same pre-existing, unrelated Phase-8 `ModelSelector` pins).
Net production routing behavior: unchanged today. What changes is that a
real signal now EXISTS and is READABLE the moment a human deliberately adds
`"cinefield-eval"` to `trustedEvaluators` — a disclosed, unmade business
decision, not a silent one.

`/admin/model-quality` (new nav link) is read-only — no mutation route
exists on this surface at all (confirmed structurally) — and deliberately
does not require Phase 7's separate `assertRouteAdmin()` route-authority
allowlist, matching `/admin/slo-cost`'s own ambient-Phase-16-admin-only
pattern for a report that changes nothing. Online feedback
(`src/lib/eval/production-sample.ts`) is a pure, tested sampling function
— every failed `generation_attempts` row sampled unconditionally (the
roadmap's own "kötü örnekleri golden dataset'e ekle" instruction), a
configurable rate for successes — with no automated, unattended caller:
confirmed fresh this batch that no `schedules.task()`/cron exists anywhere
in this repository, the same honest gap Phase 21's `canary-guardrail.ts`
already disclosed for the identical reason.

### Contract governance (Phase 20) composed, not duplicated

One new domain event: `audit.eval-run-completed@1`, reusing the existing
`audit` family/topic (already used once, by Phase 21's `audit.flag-changed`).
Payload carries only bounded aggregate facts — run id, provider/model
identity, case counts, mean quality score — never a per-case score, a
prompt, or an output URL. Regenerating `openapi/cinefield.json`/
`api-types.ts` confirmed the Phase 20 hyphen-splitting fix (from the Phase
21 corrective batch) generalizes correctly to this event's own
`audit.eval-run-completed` type without further changes.

### Ownership preserved

`PHASE_20_CONTRACT_OWNER_PRESERVED`, `TEMPORAL_OWNER_PRESERVED`,
`ROUTER_OWNER_PRESERVED`, `BILLING_OWNER_PRESERVED`: all YES. Phase 7's own
scoring formula/decision function, Phase 9-E's moderation judgment, Phase
15-B's cost arithmetic, and Phase 19's policy engine are all imported by
type or reused by call, never redeclared — confirmed by grepping every new
eval file for a second definition of any of their contracts. No second
policy engine, no second Tier-0 authority, no second contract registry, no
second router.

### Not in this batch

Braintrust (or LangSmith) account/SDK — `BUSINESS_DECISION_REQUIRED`; the
roadmap's own text explicitly permits "Braintrust/custom eval," and
explicitly instructs keeping any live Braintrust connection
read/analysis-only with the router's real decision sourced from the local
DB regardless — the local DB-backed system this batch built already
satisfies that framing without a live account. A live AI judge for
adherence/quality/consistency — `DEFERRED_EXTERNAL`, the same "no live
paid generation without explicit authorization" line held everywhere else
in this project. Flipping `DEFAULT_QUALITY_POLICY.trustedEvaluators` to
trust `"cinefield-eval"` in production routing — `BUSINESS_DECISION_REQUIRED`,
deliberately left to a human. Automated `model_routes`-diff candidate
extraction for a fully automatic CI gate — a real, disclosed future item.
A live Trigger.dev schedule for automatic online-sample feedback — the same
`LIVE_DEFERRED` gap Phase 21 already disclosed for its own canary trigger.

### Phase 22 corrective batch — traceability, quality dashboard, threshold governance, CI enforcement

The Phase 22 Master Closure Audit found four real gaps, narrowly fixed here.
Nothing outside these four areas was touched — Phase 7 routing, Phase 17's
manifest compiler, Phase 19 policy, Phase 20 contracts, and Phase 21 rollout
remain exactly as they were.

**Model/manifest/compiler version traceability — real, and honestly
partial.** `src/lib/product-intelligence/compatibility-seam.ts`'s
`mapGenerationManifestToCreateRequest()` now attaches
`metadata.semanticVersion = { manifestVersion, compilerVersion, intentId }`
onto every `GenerationCreateRequest` it produces — the same namespaced-key
convention `generation-create-service.ts`'s own `routing` metadata key
already established, so no migration was needed; `generations.metadata` was
already an unbounded jsonb column. This makes the values reachable for any
generation admitted through the one real, live caller of that function,
`POST /api/product-intelligence/execute`. **`POST /api/generate`, the
primary generation path, still carries no semantic version at all** — it
builds its `GenerationCreateRequest` directly from client UI state and never
compiles a manifest, and making it do so would be a Phase 17 redesign this
corrective batch is not authorized to make. `MODEL_VERSION_TRACEABILITY`
remains `PASS` (via `generation_attempts.model_version_id`, independent of
any of this). `MANIFEST_VERSION_TRACEABILITY`/`COMPILER_VERSION_TRACEABILITY`
move from `FAIL` to `PARTIAL`: the mechanism is real and live, scoped to one
of two admission paths.

**Prompt version — `CANONICAL_COMPILER_VERSION`, not fabricated.** This
repository has no distinct `promptVersion` concept anywhere, and this batch
does not invent one. `GenerationManifest.compilerVersion` (bumped by hand
whenever `manifest-compiler.ts`'s precedence/conflict-detection logic
changes — see `generation-manifest-contract.ts`'s own header) is the closest
real thing to "which logic produced this prompt," and is documented here,
explicitly, as the canonical owner of that question until a real, distinct
prompt-versioning concept exists.

**`SCORE_PASS_THRESHOLD` — no longer a hardcoded default.** The closure
audit found `SCORE_PASS_THRESHOLD = 0.7` had no roadmap source and no prior
repository authority (a fresh re-extraction of the Phase 22 roadmap section
found zero numeric thresholds anywhere in it). `verdictForScore()` now
requires an explicit `threshold: number | null` argument;
`parseScorePassThreshold()` reads `MODEL_EVAL_SCORE_PASS_THRESHOLD` from the
environment with the exact same discipline
`MODEL_EVAL_REGRESSION_THRESHOLD` already had — required, validated to
`[0,1]`, no invented default — and a missing/malformed threshold makes every
threshold-driven dimension (latency, cost, adherence, quality, consistency)
record `inconclusive`, never a fabricated `pass`. The two thresholds remain
two separate business concepts, read from two separate env vars, in two
separate scripts — the per-case score cutoff never feeds the
candidate-vs-baseline regression tolerance or vice versa.

**Admin Model Quality dashboard — quality/latency/cost are all real now.**
`eval-store.ts`'s `latestCompletedRun()` now aggregates real
`mean latency_ms` and a currency-safe cost summary (`AVAILABLE` only when
every priced case in a run shares one currency; `MIXED_CURRENCY` reported
honestly rather than silently averaged; `NO_EVIDENCE` when nothing has a
known cost) alongside the existing per-dimension score means.
`model-quality-admin-contract.ts`'s `meanLatencyScore: null` stub is gone,
replaced with real `QualityMetricState`/`LatencyMetricState`/`CostMetricState`
types the panel renders directly — no fabricated zero for missing evidence.
The panel also now states, honestly, whether its evidence is
`CI_EVAL_EVIDENCE` or `PRODUCTION_ROUTING_CONFIDENT`, computed from the real
golden-dataset case count (7) against Phase 7's own real
`DEFAULT_QUALITY_POLICY.minSamples` (20) — today, and for as long as the
dataset stays this size, it is honestly `CI_EVAL_EVIDENCE`: real evidence,
sized for a CI smoke check, not for a production routing-confidence
decision. `minSamples` was not changed to make this look better.

**CI enforcement — the real promotion path is now gated automatically.**
Audited directly: `src/lib/routing/admin-route-service.ts` is the only live
route-mutation surface, and its three operations (enable/disable, priority,
kill switch) can never introduce a NEW `(provider_id, provider_model_id)`
pair into `model_routes` — that only ever happens via a migration file (the
only non-test `INSERT INTO model_routes` anywhere in this repository is
`20260817000000_model_routing.sql`, using a plain, git-diffable
`FROM (VALUES (...)) AS seed(model_id, provider_id, provider_model_id)`
convention). `scripts/check-new-route-eval-evidence.ts` (new) parses exactly
that real, demonstrated convention out of every newly ADDED migration file
in a PR and requires a completed eval run to already exist for every pair
found — an unparseable `INSERT INTO model_routes` blocks rather than being
silently skipped. `.github/workflows/eval-ci.yml` now runs this
automatically on `pull_request` for any change under `supabase/migrations/`,
alongside its pre-existing `workflow_dispatch`-only candidate/baseline
regression comparison (unchanged, still deliberately manual — see that
job's own header for why an automatic regression comparison would mean
spending real provider budget on every PR). This closes the loop for new
routes: no unmeasured pair can ever become routable. It does **not**
automatically detect "this migration changed which route is DEFAULT for a
model" (priority is a separate, non-migration action via
`setRoutePriority`) and therefore does not automatically trigger a
regression comparison at that moment — deciding a reprioritization event
should trigger one is a disclosed `BUSINESS_DECISION`, not a fabricated
automation. Marking the new job as a required branch-protection check is
also disclosed as an external, human, GitHub-repository-settings step this
codebase cannot perform on its own.

**Router quality signal — confirmed genuinely ready, not touched again.**
`DEFAULT_QUALITY_POLICY.trustedEvaluators` is still `[]`, still untouched by
this batch. Both branches this corrective brief asked to confirm were
already proven by Phase 7-D's own pre-existing test
(`phase-7d-cost-quality-routing.e2e.test.ts`): an untrusted evaluator's
signal grants no routing advantage, and a LOCAL `QualityPolicy` object (not
the mutated global default) with `trustedEvaluators: ["cinefield-eval"]`
does let a signal reach `scoreRouteComposite()`'s real composite score.
Nothing in `route-quality.ts`/`route-scoring.ts` was touched to confirm
this.

**Phase 22 does not start Phase 23.**

## Phase 23 — Privacy, GDPR & Data Lifecycle Architecture

**Authoritative roadmap source:** the same master DOCX authoritative for
Phases 17/19/20/21/22. Official title: "Phase 23 — Privacy, GDPR & Data
Lifecycle Architecture." Handoff, stated explicitly: "Phase 9 media
ownership/quarantine/retention foundation devralınır; data subject rights,
deletion/takedown, retention policy ve privacy lifecycle burada
tamamlanır" — Phase 9's storage foundation is inherited; data-subject
rights, deletion, retention policy, and privacy lifecycle are COMPLETED
here. Four official packages: 23-A (data classification + retention/
purpose/legal-basis matrix + processor/DPA/data-region inventory), 23-B
(`privacy_requests` + DSAR export endpoint/workflow), 23-C
(`AccountDeletionWorkflow` + `deletion_tombstones` + backup-aging/restore
re-delete control as ONE deletion package), 23-D (admin privacy view +
processor/region records).

### The scaffolding this phase fills already existed, deliberately unimplemented

A repository-wide reality audit found `media_assets` (Phase 9-A) already
carries FOUR Phase 23 hook columns — `data_class`, `retention_policy`,
`legal_hold`, `tombstoned_at` — added, unfilled, with the migration's own
comment stating plainly: "Politika sahibi Phase 23; uygulama noktası bu
Phase'dir" (policy owner is Phase 23; the implementation point is this
Phase). `policies/data/actions.json` already registered `data.export`,
`data.delete`, `retention.override`, `legal_hold.set`, `legal_hold.clear`
as `critical: true`, `requiredRoles: ["route_admin"]`,
`requiresTwoPerson: true`, `requiresHumanApproval: true`,
`implemented: false`, `owner: "phase-23"` — and `policies/conformance/
cases.json` pinned the expected DENY/`not_implemented` behavior for all
five, so this phase's job was never to invent authorization policy, only
to build real handlers against an already-reviewed contract.

### 23-A — data classification, retention matrix, processor/DPA inventory

Source-controlled TypeScript, the same "golden dataset is code, reviewable
via PR diff" precedent Phase 22 established: `src/lib/privacy/data-
classification.ts` (14 entries — every real table carrying user-identifying
or user-generated data, each with `dataClass`/`purpose`/`legalBasis`/
`owner`/`storageLocation`/`retentionPolicy`/`deletionPolicy`) and
`src/lib/privacy/processor-inventory.ts` (9 entries — every real,
WIRED processor this codebase actually sends data to today: fal.ai,
Gemini, Cloudflare Workers AI, Clerk, Supabase, Cloudflare R2, AWS S3 DR,
AWS SQS, Temporal Cloud — deliberately excluding `secret-registry.ts`'s
named-but-`DEFERRED` entries with no real adapter, e.g. OpenAI/ElevenLabs/
Stripe, which send no data today). `dataClass` values are enforced by a
real CHECK constraint on `media_assets.data_class`
(`20260910000000_privacy_lifecycle.sql`), one vocabulary shared by both.
Every `dpaStatus` is honestly `NOT_CONFIGURED` — this repository tracks no
real, signed DPA with any vendor, and the inventory does not fabricate
one; 23-D's admin view makes this gap visible rather than hidden.

### 23-B — `privacy_requests`, DSAR export

New migration adds `privacy_requests` (mutable lifecycle row — pending →
processing → completed/failed/rejected, `resolution_consistency` enforced
at the schema so a resolved row always records who/when) alongside the
media_assets hook fills. Self-service creation is genuinely unprivileged:
`POST /api/privacy/requests` reads `clerk_user_id` from a verified Clerk
session only, never a client-supplied target — the roadmap's own named
risk ("Yanlış authorization uygulanmış bir DSAR/export endpoint'i doğrudan
'tüm kullanıcı verisini ZIP olarak ver' API'sine dönüşür") is closed
structurally, not by convention. `src/lib/privacy/dsar-export.ts` gathers
the requesting user's own profile/projects/generations/media-asset-
metadata/credit-summary — bounded (`MAX_DSAR_BUNDLE_BYTES`, refuses rather
than truncates) — and is the ONE deliberate inversion of this codebase's
usual "never a raw prompt" discipline: GDPR Article 15 entitles a data
subject to their own data verbatim, and a prompt is the user's own data.
Delivery reuses `r2-client.ts`'s existing `createPresignedDownload`
(`DOWNLOAD_URL_TTL_SECONDS`, one-time, short-lived) rather than inventing
a second signing path. The raw `export_object_key` is never selected by
ANY read function (`privacy-request-store.ts`, `privacy-admin-service.ts`)
— only a derived `hasExport` boolean — a real defect this batch's own
regression run caught and fixed (a pre-existing Phase 16-A sensitive-data
sweep correctly flagged the raw key as a forbidden `object_key`-shaped
column on a lower-privilege read surface).

### 23-C — `deletion_tombstones`, AccountDeletionWorkflow, restore re-delete control

`deletion_tombstones` (append-only, `UNIQUE(clerk_user_id)`,
`ON CONFLICT DO NOTHING` semantics) is the durable "this account is gone"
record. `src/lib/privacy/account-deletion-workflow.ts`'s
`executeAccountDeletion()`: (1) refuses idempotently against an
already-tombstoned account; (2) for every `media_assets` row NOT under
`legal_hold` — the roadmap's own named exception, "legal-hold işaretli
asset'ler retention dolsa bile istisna olarak korunur" — attempts a real
R2 hot-object delete (`r2-client.ts`'s new `deleteAssetObject`, Phase 23's
own addition, a genuinely different IAM identity from the DR backup
client, which has no delete permission at all) and tombstones the row
regardless of physical-delete outcome; (3) anonymizes `profiles`' PII
columns (`username`/`email`/`display_name`/`avatar_url`) — the ROW is
never deleted, since every other table FKs to `profiles.clerk_user_id`
and `credit_ledger` in particular must remain addressable
(`data-classification.ts`: `deletionPolicy: "retain_immutable"`, a
financial record survives account deletion); (4) records the tombstone;
(5) calls Clerk via a dependency-injected `ClerkUserDeleter` seam
(`clerk-account-service.ts`) — the same discipline `eval-runner.ts`'s
`ProduceOutputFn` established: never invoked live by this repository's own
tests, a genuinely irreversible external action gated behind Tier-0 dual
control. `src/lib/privacy/restore-redelete-guard.ts`'s
`reapplyTombstonesAfterRestore()` is the roadmap's own named "restore
re-delete control" — idempotently re-applies the exact same anonymization
to any `deletion_tombstones`-matching row a Postgres restore could have
resurrected. Honestly `LIVE_DEFERRED`: no live restore-EXECUTION capability
exists anywhere in this repository to hang a post-restore hook off of yet
(`restore-verification-engine.ts`, Phase 15, is deliberately read-only —
confirmed by `tier0-action-catalogue.ts`'s own header, "no execute action
exists yet anywhere in this repository to classify"), so this function is
real and tested, with zero production callers today — the same class of
disclosed gap `production-sample.ts` (Phase 22) already established.

### 23-D — Admin Privacy view, `data.export`/`data.delete` wired into policy + Tier-0

`GET /api/admin/privacy` (read-only: the real classification matrix,
processor inventory, recent `privacy_requests`, tombstone count) and
`POST /api/admin/privacy/execute` (the privileged path) are new.
`data.export`/`data.delete` are the ONE place in this registry where
`requiresHumanApproval` (the OPA-mirrored `policies/data/actions.json`
gate) is true ALONGSIDE `requiresTwoPerson` (Tier-0's
`admin_privileged_action_events` dual control) for the same action — a
genuine composition question neither `route.disable` nor
`queue.dlq.redrive` (which only set `requiresTwoPerson`) ever exercised.
Resolved by reading `requirePolicy()`'s own documented contract
(`deployment-policy-gate.ts`'s header: approval evidence must be "resolved
from durable state by the caller... a Phase 16-E durable approval if the
trigger is itself an admin action") literally: Tier-0 authorizes FIRST
(it is the evidence's real owner — two DISTINCT approvers already recorded
for this `tier0RequestId` IS the human-approval evidence, one durable fact
read twice, never a third approval mechanism), and `requirePolicy()` runs
SECOND, unconditionally, as the final gate immediately before real work —
a deliberate, documented deviation from `router-admin-service.ts`'s
"policy is the first gate" convention, justified narrowly for this one
action pair. `data.export`/`data.delete` are now flipped to
`implemented: true`; `retention.override`/`legal_hold.set`/
`legal_hold.clear` deliberately remain `implemented: false` — out of this
batch's scope, not silently completed alongside the two done criteria
actually require. `policies/conformance/cases.json` and the OPA rego suite
(`opa test`, 13/13) and `policy-wasm-parity.ts` (63/63) were all
re-verified fresh against the updated registry.

### Ownership preserved

`PHASE_9_STORAGE_OWNER_PRESERVED`, `PHASE_12_SECURITY_OWNER_PRESERVED`,
`PHASE_15_DR_OWNER_PRESERVED`, `PHASE_16_ADMIN_OWNER_PRESERVED`: all YES.
`media_assets`' own hook columns are filled, never re-created (one
migration, `ALTER TABLE`, no new `media_assets` definition);
`policies/data/actions.json`'s pre-existing five-action scaffolding is
extended (two flipped, three left alone), never replaced; Tier-0's
`authorizeTier0Action`/`decidePrivilegedAction`/
`admin_privileged_action_events` are reused byte-for-byte, with two new
`TIER0_ACTION_CATALOGUE` entries following the exact existing shape;
`restore-verification-engine.ts` (Phase 15) is untouched — the restore
re-delete control is Phase 23's own, separate, read-write function, never
a mutation added to Phase 15's read-only engine.

### Narrow corrective batch — retention-expiry cleanup mechanism

The Phase 23 Master Closure Audit found a real gap: the roadmap's own
phase-level done-criterion ("retention süresi geçen veriler temizleniyor" —
data past its retention period is cleaned up) had no mechanism anywhere in
the codebase, despite 23-A's retention matrix existing. This batch builds
that mechanism, honestly, without inventing the one thing that was
genuinely missing — real retention durations.

**`src/lib/privacy/retention-policy-resolver.ts`** — a pure, no-I/O decision
layer. `resolveClassRetention(entry)` maps a `DATA_CLASSIFICATION_MATRIX`
entry to `KEEP` / `RETAIN_IMMUTABLE` / `NOT_APPLICABLE` /
`BUSINESS_DECISION_REQUIRED` / `ROW_EVALUATION_REQUIRED{durationDays}`.
`resolveRowRetention(row, durationDays, action, now)` maps one row to
`KEEP` / `LEGAL_HOLD` (checked first, unconditionally dominant) /
`NOT_CONFIGURED` (unparseable timestamp) / `DELETE|ANONYMIZE{cutoffAt}`.
Neither function ever fabricates a duration: an entry with no
`retentionDurationDays` set resolves to `BUSINESS_DECISION_REQUIRED`, full
stop.

**A real labeling correction, made in the same batch:** four of the five
tables originally classified `retentionPolicy: "audit_window_only"` /
`deletionPolicy: "retain_for_audit_window"` in 23-A — `security_events`,
`admin_privileged_action_events`, `feature_flag_audit`,
`deletion_tombstones` — were re-inspected against their own migrations and
found to already carry a real, unconditional `BEFORE UPDATE OR DELETE`
trigger (confirmed in `20260826000000_security_events.sql`,
`20260829000000_tier0_admin_action_audit.sql`,
`20260901000000_feature_flags.sql`, `20260910000000_privacy_lifecycle.sql`
respectively). "Pending a window decision" was never actually true for
these four — cleanup has been schema-impossible since each table's own
creation. Reclassified to `retentionPolicy: "append_only_permanent"` /
`deletionPolicy: "retain_immutable"`. `privacy_requests` is left
unchanged — the one table in that original group of five with no such
trigger, so it remains the genuinely undecided
`BUSINESS_DECISION_REQUIRED` case.

**`src/lib/privacy/retention-cleanup-executor.ts`** — the real, runnable
mechanism, `MANUAL_OPERATOR_CALLER` only (no scheduler, no cron, no new
admin route or UI this batch — none is genuinely required while every real
class is inert). `evaluateRetentionCleanup(admin, {dryRun})` walks all 14
`DATA_CLASSIFICATION_MATRIX` entries, resolves each class, and for any
class reaching `ROW_EVALUATION_REQUIRED` with a table this file has an
explicit, hand-written performer for, queries a bounded, deterministically
ordered (`created_at ASC`, capped at `MAX_CLEANUP_BATCH_SIZE`) batch and
evaluates each row. `dryRun: true` returns bounded evidence only (table,
row id, the verdict's action/reason/cutoff) and mutates nothing;
`dryRun: false` performs the same-computed action through that table's
registered performer. A class needing row evaluation on a table with NO
registered performer fails closed as `unsupported_table` — there is no
code path that accepts a table name or SQL fragment from a caller.

The one registered performer, `media_assets`, reuses
`account-deletion-workflow.ts`'s own R2 object-removal call
(`deleteAssetObject`) rather than a second deletion path, and tombstones
the row the same way `AccountDeletionWorkflow` does — so a row this
executor cleans up is indistinguishable, downstream, from one
`AccountDeletionWorkflow` cleaned up. `legal_hold` rows are excluded by
the resolver (checked first, unconditionally); already-tombstoned rows are
excluded by the fetch query itself, making a repeat run over the same
table naturally idempotent.

**Today this remains fully inert, honestly.** `media_assets` itself is
classified `retentionPolicy: "account_lifetime"` (resolves to `KEEP`, tied
to account deletion, not an independent age cutoff) — no real
`DATA_CLASSIFICATION_MATRIX` entry has `retentionDurationDays` set, so no
real class ever reaches `ROW_EVALUATION_REQUIRED` and no real row is ever
touched by this mechanism as shipped. `retention-cleanup-executor.test.ts`
proves the row-level DELETE/ANONYMIZE/legal-hold/idempotency/fail-closed
behavior against a *synthetic* entry with a fabricated 90-day duration —
never against a real table — the same "prove the seam works, don't invent
the policy" discipline `retention-policy-resolver.test.ts` and Phase 22's
`trustedEvaluators: []` already established. Activating real cleanup for
any table requires one deliberate, reviewed change: setting
`retentionDurationDays` on that table's own `DATA_CLASSIFICATION_MATRIX`
entry — not new code.

Billing tables (`credit_ledger`/`credit_wallets`/`credit_reservations`)
and every `retain_immutable` table are untouched by construction: their
class verdict is `RETAIN_IMMUTABLE`, which never reaches row evaluation.
`privacy_requests`/`deletion_tombstones` — the two tables holding evidence
of a person's own deletion/export — are likewise never at risk of
accidental self-expiry: `deletion_tombstones` is `retain_immutable`
(append-only trigger), and `privacy_requests` is
`BUSINESS_DECISION_REQUIRED` (no duration defined), so this batch cannot
expire the very evidence it depends on.

No migration was needed — the executor is pure application logic over
`data_class`/`retention_policy`/`legal_hold`/`tombstoned_at`/`created_at`
columns Phase 9-A and Phase 23-A already added. No new `policies/data/
actions.json` entry was added — no real, exposed destructive admin
operation exists this batch to register; if a future batch wires this
behind an admin route, that route must go through the existing
`requireAdminAccess()` → policy → Tier-0-if-destructive chain like every
other privileged admin action, never a new approval system.

### Not in this batch

`retention.override`/`legal_hold.set`/`legal_hold.clear` real handlers —
`BUSINESS_DECISION_REQUIRED` scope beyond what 23-A/B/C/D's own done
criteria require this batch. A live Clerk webhook (Clerk-originated
account-deletion triggering this workflow automatically) —
`DEFERRED_EXTERNAL`; the roadmap's own wording asks this workflow to
orchestrate deletion OUT to Clerk (an admin-triggered, dual-control-gated
action calling Clerk's delete API), not to react to an inbound Clerk
event, so this scope decision is a reading of the roadmap's actual words,
not a shortcut. A signed DPA with any processor — `BUSINESS_DECISION_
REQUIRED`, outside what code can prove. Live post-restore automatic
re-application of `reapplyTombstonesAfterRestore()` — `LIVE_DEFERRED`, no
live restore-execution capability exists in this repository yet to hook
into. Third-party AI processor-side data deletion (fal.ai/Gemini/
Cloudflare Workers AI exposing no delete API this codebase can call) —
disclosed in `processor-inventory.ts`'s own header, not fabricated.
**Phase 23 does not start Phase 24.**
