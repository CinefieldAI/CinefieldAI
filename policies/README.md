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
                               by OPA as data.cinefield.actions and imported
                               directly by the TypeScript engine
  conformance/cases.json       the shared conformance table
```

## OPA runtime contract

The application does **not** require OPA to be installed, and policy
availability never depends on a network call, a sidecar, or a paid service.
The registry is imported into the bundle, so the policy ships with the
deployment.

OPA is required only to run the Rego half of the conformance suite. It is not
a dependency of the build, the tests, or production.

Install (any one):

```bash
brew install opa                      # macOS
choco install opa                     # Windows
# or download a release binary from https://github.com/open-policy-agent/opa
```

Then:

```bash
npm run policy:test    # opa test policies/ -v
npm run policy:eval    # evaluate against a stdin/-i input document
npm run policy:build   # compile a WASM bundle (Phase 19)
```

`policy:build` exists for **Phase 19**, which owns standing up OPA properly
(roadmap ¶2272 — "OPA sidecar/service ve policy repository kur") and the full
policy lifecycle. When that lands, the runtime evaluator is replaced by the
compiled bundle and `PolicyDecision.engine` changes from `"embedded"` to
`"opa-wasm"` — which is why the engine name travels in every recorded
decision. The conformance table is what makes that swap provable rather than
hopeful.

## Why the runtime is embedded today

The roadmap's own ownership decision places full OPA among the scale-triggered
layers (¶416, ¶3734, ¶3766). Beyond following that: a policy sidecar would make
every critical action depend on a second process being alive, and for a
fail-closed gate that means an outage in the policy process stops quarantine
handling entirely. An embedded evaluator is available exactly when the
application is.
