# Cinefield policy bundle

`policies/cinefield/policy.rego` is the **normative** policy gate for critical
actions (Phase 12-E). `src/lib/policy/policy-engine.ts` implements exactly its
rules at runtime, and the two are bound together by
`policies/conformance/cases.json` — `policy_test.rego` iterates that table under
`opa test`, and `src/test/e2e/phase-12e-policy-gate.e2e.test.ts` iterates the
same table under `npm test`. Add a case to the table, never to one side only.

## Layout

```
policies/
  cinefield/policy.rego        the rules — normative
  cinefield/policy_test.rego   the Rego suite (iterates the shared table)
  data/actions.json            the action registry — ONE definition, loaded
                               by OPA at data.data (OPA's own directory-based
                               convention: a JSON file's content lands under
                               its directory path, not its filename — this
                               file's own name is not part of the path) and
                               imported directly by the TypeScript engine
  conformance/cases.json       the shared conformance table, loaded by OPA
                               at data.conformance
  bundle/                      gitignored — `npm run policy:build` output
```

## OPA runtime contract

The application does **not** require OPA to be installed, and policy
availability never depends on a network call, a sidecar, or a paid service.
The registry is imported into the bundle, so the policy ships with the
deployment. `PolicyDecision.engine` is `"embedded"` everywhere in
production — this remains true after Phase 19 (see below).

OPA is required only to run the Rego half of the conformance suite, build the
WASM bundle, and check embedded/WASM parity. It is not a dependency of the
build, the tests, or production request handling.

Install (any one):

```bash
brew install opa                      # macOS
choco install opa                     # Windows
# or download a release binary from https://github.com/open-policy-agent/opa
```

Then:

```bash
npm run policy:test          # opa test policies/ -v
npm run policy:eval          # evaluate against a stdin/-i input document
npm run policy:build         # compile a WASM bundle
npm run policy:wasm-parity   # prove the WASM bundle and the embedded
                              # evaluator agree on every conformance case
```

**Phase 19 status.** OPA is now installed and actually run — by CI
(`.github/workflows/policy-ci.yml`, on every `policies/**` change) and by
this batch's own verification (`opa test`: 9/9 for real, having found and
fixed a genuine data-path defect the suite had never previously caught —
`data.cinefield.actions`/`data.cinefield.conformance` never resolved under
real OPA; the working paths are `data.data`/`data.conformance`, corrected
above). `opa build -t wasm` compiles a real bundle, and
`scripts/policy-wasm-parity.ts` proves it agrees with the embedded
TypeScript evaluator across all 49 conformance cases — not assumed from
sharing a JSON file, actually run.

The compiled WASM bundle is **CI-proof only**. `PolicyDecision.engine`
stays `"embedded"` in every production code path; nothing imports
`opa-wasm`/`loadPolicy` outside the parity script. A live OPA
sidecar/service (roadmap ¶2272, "OPA sidecar/service ve policy repository
kur") was deliberately not stood up this batch — an always-live second
process is exactly the shape of risk a fail-closed gate should avoid
absorbing without a scale-driven reason, echoing the Phase 16-E lesson
that a shadow/parity mechanism must never risk becoming fail-open. If a
live sidecar becomes necessary, `PolicyDecision.engine` flips to
`"opa-wasm"` then — the field already exists to make that swap provable,
not hopeful, exactly as this file previously anticipated.

## Why the runtime is embedded today

The roadmap's own ownership decision places full OPA among the scale-triggered
layers (¶416, ¶3734, ¶3766). Beyond following that: a policy sidecar would make
every critical action depend on a second process being alive, and for a
fail-closed gate that means an outage in the policy process stops quarantine
handling entirely. An embedded evaluator is available exactly when the
application is.
