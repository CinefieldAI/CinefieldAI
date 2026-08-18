# Infrastructure emergency-change runbook (Phase 18-D)

This is the ONE sanctioned path for changing production infrastructure
outside `infra-apply.yml`. It exists because an incident sometimes cannot
wait for a PR, a plan, and a reviewer — but "console forever" is explicitly
**not acceptable**: every emergency change gets reconciled back into
Terraform, reviewed, and confirmed drift-clean before this runbook is done.

If you can wait for a normal PR + `infra-apply.yml` run, do that instead.
This runbook is for when you genuinely cannot.

## 1. Make the emergency console change

Do the minimum necessary in the AWS (or Cloudflare) console to resolve the
incident. Nothing here can be pre-authorized generically — the change is
whatever the incident actually requires.

## 2. Record actor and reason, immediately

Before doing anything else, post in the incident channel (or, if none
exists yet, open a GitHub issue tagged `infra-emergency-change`) with:

- who made the change (a real identity, not "someone")
- exactly what was changed (resource, region, before/after)
- why it could not wait for the normal apply path
- a link to the incident this responds to, if one exists

This is the durable record. It lives in the incident channel / issue
tracker on purpose — not a new database table. The actor here is a human
operating the AWS console directly, not a Clerk admin session and not a
GitHub Actions identity, so it does not fit Phase 16-E's admin-privileged-
action audit schema (`admin_privileged_action_events`), which is scoped to
actions taken through this application's own admin surface. Building a
third audit mechanism to force-fit this into that table would duplicate a
concept, not close a real gap — this is the honest owner: the incident
record itself.

## 3. Confirm the immediate operational effect

Verify the console change actually resolved what it was meant to resolve
before moving on. An emergency change that didn't work is a second
incident, not a reconciliation problem yet.

## 4. Reconcile Terraform to match, as a normal PR

Open a PR that changes `infra/` so the declared configuration matches what
now actually exists. This goes through `infra-ci.yml` exactly like any
other infra PR — fmt, validate, plan, review — no exemption for "it was
already applied by hand."

## 5. Review the plan carefully

The plan for this PR should show **no unexpected destroy/recreate** — if
the Terraform change correctly describes the console change, the plan
should show either "no changes" (if the resource is already Terraform-
managed and the console value now matches the declared one) or the
narrow, expected diff. A plan showing something wider than the emergency
change itself means the reconciliation PR does not actually match what was
done — fix the PR, not the console.

## 6. Import or correct configuration if the resource wasn't Terraform-managed yet

If the emergency change touched a resource Terraform doesn't manage at
all, this is where it gets brought in — via `terraform import` (run by a
human with real credentials, from a machine with `terraform` installed,
never from CI) or an `import` block, reviewed in the same PR. Never force
a destroy/recreate to "fix" an unmanaged resource that is working
correctly; importing it is strictly safer.

## 7. Confirm drift returns clean

After the reconciliation PR merges, the next scheduled `infra-drift.yml`
run (or a manual `workflow_dispatch` of it, if the incident doesn't allow
waiting for the schedule) must report `NO_DRIFT` for the affected
environment. If it still reports `DRIFT_DETECTED`, the reconciliation was
incomplete — repeat from step 4.

## 8. Retain the evidence

The incident record from step 2, the reconciliation PR (with its
`infra-ci.yml` plan artifact), and the clean `infra-drift.yml` run
together are the full evidence trail for this emergency change. Nothing
here is deleted or summarized away — the PR and the workflow runs are
already durably retained by GitHub (plan artifacts: 90 days on
`infra-ci.yml`, 365 days on `infra-apply.yml`; workflow run history:
per the repository's own retention setting).

---

## What this runbook explicitly does not allow

- A console change that is never followed by steps 4–7. Every emergency
  change gets reconciled — there is no "temporary" console state that
  becomes permanent by inertia.
- Skipping step 2 because the incident felt too urgent to pause for. The
  record takes one message; do it before the console change if genuinely
  faster, but do it.
- Treating a clean `infra-drift.yml` run as optional confirmation. It is
  the done criterion for this runbook, not a nice-to-have.

## Live-configuration prerequisite

This whole path assumes `infra/bootstrap/` has been applied for real (a
live AWS remote-state bucket and lock table exist) and `infra-drift.yml` /
`infra-apply.yml`'s repository variables/secrets
(`AWS_ROLE_ARN`, `TF_STATE_BUCKET`, `TF_STATE_DYNAMODB_TABLE`, `AWS_REGION`,
`CINEFIELD_APP_URL`, `CINEFIELD_INFRA_DRIFT_INGEST_TOKEN`) are configured.
Until then, step 7 has nothing to confirm against — that is a live,
external gap (see `infra/README.md` and `docs/security-gates.md`'s Phase
18 section), not a flaw in this runbook.
