# Secret leak runbook

Phase 12-D. Roadmap ¶1645 ("credential-leak rotation runbook'u kur"), ¶1680,
¶2694 ("revoke/rotate → worker reload → verify → old credential dead check →
audit timeline").

**Assume the credential is compromised the moment you suspect it.** A leaked
key in a public repository is scraped in minutes; a leaked provider key spends
real money silently. The cost of an unnecessary rotation is one deploy. The
cost of a delayed one is unbounded.

---

## CONTAIN → ROTATE → REVOKE → AUDIT → REDEPLOY → VERIFY

Same six phases every time. The order matters: revoking before the replacement
is deployed turns a suspected leak into a certain outage, which is how people
end up hesitating during the next one.

### 1. CONTAIN
Stop the bleeding without breaking the system.
- Identify exactly which credential, using
  [`secret-registry.ts`](../../src/lib/config/secret-registry.ts) — it tells
  you the class and which runtimes hold it.
- If the credential can spend money (any `PROVIDER_SECRET`), check the
  provider dashboard for unfamiliar usage **now**, before rotating: after
  rotation you lose the ability to attribute it.
- Do **not** delete the leaked artifact yet if it is evidence (a commit, a log
  line). Note where it is.

### 2. ROTATE
Follow [secret-rotation.md](./secret-rotation.md) steps 1–3. Create, deploy,
validate. The old credential is still live at this point — deliberately.

### 3. REVOKE
Now kill the old one at the issuer.

### 4. AUDIT
Before the trail ages out.
- Provider: usage in the exposure window. Anything you did not initiate?
- Supabase: unexpected reads or writes with the service role.
- Redis: unexpected keys or flushes.
- AWS: CloudTrail for the credential's principal.
- Cinefield: `security_events` for the window — `policy_decision_denied`,
  `outbound_fetch_blocked`, `rate_limit_denied` clusters.

### 5. REDEPLOY
Every runtime that held the credential restarts. A worker picks up a new
secret on restart, not in place — the injection matrix in
[least-privilege.md](../security/least-privilege.md) lists who holds what.

### 6. VERIFY
- The old credential **fails a real call**. Test it; do not assume.
- `validateConfiguration()` reports `ok`.
- The system works: one end-to-end generation against a mock model, and one
  realtime connection.
- Write the timeline: discovered, contained, rotated, revoked, verified, and
  what the audit found.

---

## By leak type

### Provider API key
Money leaves immediately and quietly. Check usage before rotating (step 1),
then run the six steps. Because ¶1686 gives each provider its own secret and
its own scope, the blast radius is **one** provider — that isolation is the
control that makes this survivable, and it is why a shared `PROVIDER_API_KEY`
is a build failure rather than a style preference.

### `SUPABASE_SERVICE_ROLE_KEY`
The worst case. It bypasses RLS entirely: every user's rows, every generation,
every media asset. Cut-over rotation, so accept the window. Audit for reads
you did not make. Assume data was read unless the audit shows otherwise —
"no evidence of access" is not "no access" when the logs were not enabled.

### `CLERK_SECRET_KEY`
The identity plane. Holder can act on any user. Rotate, then review Clerk's
own audit log for user or session changes in the window.

### `REDIS_URL` / `BULLMQ_REDIS_URL`
The password is inline in the URL, so a leaked URL is a leaked credential.
Rotate A and B independently — they are separate credentials (6R.25 / ¶1225).
Redis holds no durable truth, so the loss is rate-limit counters, leases and
cache: flush rather than trust them. Then confirm the two URLs are still
distinct; `validateConfiguration()` fails closed if they are not.

### `TEMPORAL_API_KEY`
Workflow control: start, signal, cancel. Dual-key rotation is available, so
there is no window. Review workflow history for executions nobody started.

### AWS / R2 credentials
R2 keys rotate as a pair with overlap. For AWS: a long-lived access key in a
deployment is itself the finding — production uses task roles. If one leaked,
rotate it and then remove the need for it.

### Accidental Git commit
Rotation first. **Removing the commit does not undo the exposure** — it was
cloned, cached, and indexed by the time you noticed. Then:
- Rotate and revoke (steps 2–3). This is what actually fixes it.
- If the repository is public, treat the value as permanently public.
- History rewriting is optional cleanup, coordinated with everyone who has a
  clone, and is never a substitute for rotation.
- Run `npm run secrets:scan` to see whether anything else is exposed in the
  same commit.

### Leaked Vercel environment variable
Usually a screenshot, a shared preview URL, or a build log. Rotate the
credential; check who had access to the project; confirm the variable is
scoped to the right environments — a production secret readable from a preview
deployment is a standing leak, not an incident.

---

## What must never appear in an incident record

Roadmap ¶1753 makes this an **allow-list**, not a deny-list: log correlation
ids, not payloads.

Never: the credential, any prefix or suffix of it, its length, a hash of it, a
Clerk token, a Stripe payload secret, a provider `Authorization` header, a
presigned or private media URL, a cookie, or a raw prompt.

Always safe: the variable NAME, the class, the exposure window, which runtimes
held it, and what the audit found.

---

## Automation, and what is not automated

Phase 25 (¶2694, ¶2683) automates the revoke → reload → verify → dead-check
loop and wires anomalous secret reads into `security.events`. Today every step
above is manual and deliberately so: an automated credential revoker is itself
a denial-of-service tool, and it belongs behind the two-person approval that
¶2284 already requires for secret operations.
