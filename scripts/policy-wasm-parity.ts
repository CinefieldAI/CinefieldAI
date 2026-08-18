import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as tar from "tar";
import { loadPolicy } from "@open-policy-agent/opa-wasm";
import { evaluatePolicy } from "@/lib/policy/policy-engine";
import type { PolicyInput } from "@/lib/policy/policy-contract";

/**
 * Real WASM/embedded parity proof (Phase 19).
 *
 * `policies/cinefield/policy_test.rego` already proves the Rego decision
 * matches the shared conformance table under `opa test`. This script closes
 * the other half: it BUILDS the real `opa build -t wasm` bundle, LOADS the
 * compiled `.wasm` module with the real OPA-WASM runtime
 * (`@open-policy-agent/opa-wasm`, no mock), evaluates it against the exact
 * same conformance table, and compares each result against
 * `evaluatePolicy()` — the embedded TypeScript engine that is production
 * authority TODAY. Section 9's own instruction is followed literally: "Do
 * not assume Rego and TS match because they use the same JSON catalogue" —
 * this proves it by actually running both.
 *
 * CI-time proof only. This script never runs from application code, and
 * loading the WASM module here never makes it production authority —
 * `policy-gate.ts`'s `requirePolicy()` is unchanged and still calls
 * `evaluatePolicy()` exclusively. See docs/security-gates.md's Phase 19
 * section for the embedded-vs-WASM engine-transition state this
 * intentionally stops at (SHADOW_PARITY, not OPA_WASM).
 */

const ROOT = process.cwd();
const BUNDLE_PATH = path.join(ROOT, "policies/bundle/policy.tar.gz");
const CASES_PATH = path.join(ROOT, "policies/conformance/cases.json");

interface ConformanceCase {
  name: string;
  patch: Record<string, unknown>;
  expect: { decision: string; reason: string };
}

interface ConformanceFile {
  baseInput: Record<string, unknown>;
  cases: ConformanceCase[];
}

function buildBundle(): void {
  execFileSync(
    "opa",
    ["build", "-t", "wasm", "-e", "cinefield/policy/decision", "policies/", "-o", BUNDLE_PATH],
    { cwd: ROOT, stdio: "inherit" }
  );
}

async function main(): Promise<void> {
  if (!existsSync(BUNDLE_PATH)) {
    console.log(
      JSON.stringify({ result: "building_bundle", path: "policies/bundle/policy.tar.gz" })
    );
  }
  buildBundle();

  const extractDir = mkdtempSync(path.join(tmpdir(), "cinefield-opa-wasm-"));
  try {
    await tar.x({ file: BUNDLE_PATH, cwd: extractDir });

    const wasmBytes = readFileSync(path.join(extractDir, "policy.wasm"));
    const bundleData = JSON.parse(readFileSync(path.join(extractDir, "data.json"), "utf8"));

    const policy = await loadPolicy(wasmBytes);
    policy.setData(bundleData);

    const conformance: ConformanceFile = JSON.parse(readFileSync(CASES_PATH, "utf8"));

    let pass = 0;
    const failures: Array<{ name: string; embedded: unknown; wasm: unknown }> = [];

    for (const c of conformance.cases) {
      const input = { ...conformance.baseInput, ...c.patch } as unknown as PolicyInput;

      const embedded = evaluatePolicy(input);

      const resultSet = policy.evaluate(input) as Array<{ result: { decision: string; reason: string } }>;
      const wasm = resultSet?.[0]?.result;

      const embeddedMatch = embedded.decision === c.expect.decision && embedded.reason === c.expect.reason;
      const wasmMatch = wasm?.decision === c.expect.decision && wasm?.reason === c.expect.reason;

      if (embeddedMatch && wasmMatch) {
        pass++;
      } else {
        failures.push({
          name: c.name,
          embedded: embeddedMatch ? "match" : embedded,
          wasm: wasmMatch ? "match" : wasm ?? "undefined_result",
        });
      }
    }

    console.log(
      JSON.stringify({
        result: failures.length === 0 ? "parity_confirmed" : "parity_mismatch",
        totalCases: conformance.cases.length,
        pass,
        failures,
      })
    );

    if (failures.length > 0) process.exit(1);
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ result: "fatal", error: error instanceof Error ? error.message : "unknown" }));
  process.exit(1);
});
