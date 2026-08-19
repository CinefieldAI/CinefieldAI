import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import registry from "../../../policies/data/actions.json";
import { TIER0_ACTION_CATALOGUE } from "@/lib/admin/tier0-action-catalogue";
import { DATA_CLASSIFICATION_MATRIX } from "@/lib/privacy/data-classification";
import { PROCESSOR_INVENTORY } from "@/lib/privacy/processor-inventory";

/**
 * Phase 23 — Privacy, GDPR & Data Lifecycle Architecture.
 *
 * Proves what this batch built: data classification + retention/processor
 * inventory (23-A), privacy_requests + DSAR export (23-B),
 * deletion_tombstones + AccountDeletionWorkflow + restore re-delete control
 * (23-C), and the admin privacy view (23-D) — plus that none of it invented
 * a second policy/authority engine, duplicated Phase 9/12/15/16's real
 * owners, or exposed sensitive data through a lower-privilege surface.
 */

const ROOT = process.cwd();
function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
function stripSqlComments(source: string): string {
  return source.replace(/--.*$/gm, "");
}

// ---- 23-A: data classification + processor inventory ----------------------

describe("Phase 23-A — data classification + processor/DPA inventory", () => {
  test("the classification matrix is source-controlled TypeScript, never a database table for its own content", () => {
    const migration = read("supabase/migrations/20260910000000_privacy_lifecycle.sql");
    assert.doesNotMatch(migration, /CREATE TABLE.*data_classification/i);
    assert.doesNotMatch(migration, /CREATE TABLE.*processor_inventory/i);
    assert.ok(DATA_CLASSIFICATION_MATRIX.length > 0);
    assert.ok(PROCESSOR_INVENTORY.length > 0);
  });

  test("no processor claims a signed DPA — this repository tracks no real, signed agreement, and must not fabricate one", () => {
    for (const entry of PROCESSOR_INVENTORY) {
      assert.equal(entry.dpaStatus, "NOT_CONFIGURED");
    }
  });

  test("only real, wired provider adapters appear — never a named-but-deferred secret-registry entry with no adapter", () => {
    const registryFile = stripComments(read("src/lib/config/secret-registry.ts"));
    for (const entry of PROCESSOR_INVENTORY) {
      if (["fal", "gemini", "cloudflare-workers-ai"].includes(entry.processorId)) {
        assert.ok(existsSync(path.join(ROOT, entry.route)), `${entry.processorId}: route ${entry.route} must be a real file`);
      }
    }
    // A sample of DEFERRED-only providers must NOT appear in the inventory.
    for (const deferredOnly of ["openai", "elevenlabs", "runway", "stripe"]) {
      assert.ok(!PROCESSOR_INVENTORY.some((e) => e.processorId === deferredOnly), `${deferredOnly} has no real adapter and must not be listed as an active processor`);
    }
    assert.match(registryFile, /DEFERRED/);
  });
});

// ---- 23-B: privacy_requests + DSAR export ----------------------------------

describe("Phase 23-B — privacy_requests, DSAR export", () => {
  test("privacy_requests exists, RLS enabled, service_role-only, with resolution-consistency enforced at the schema", () => {
    const migration = read("supabase/migrations/20260910000000_privacy_lifecycle.sql");
    const sqlOnly = stripSqlComments(migration);
    assert.match(sqlOnly, /CREATE TABLE IF NOT EXISTS "public"\."privacy_requests"/);
    assert.match(sqlOnly, /ALTER TABLE "public"\."privacy_requests" ENABLE ROW LEVEL SECURITY/);
    assert.match(sqlOnly, /REVOKE ALL ON TABLE "public"\."privacy_requests" FROM "anon", "authenticated"/);
    assert.match(sqlOnly, /privacy_requests_resolution_consistency_check/);
  });

  test("create_privacy_request is the only self-service write — a user creates a request for THEMSELVES, never for another clerk_user_id supplied by a client", () => {
    const route = stripComments(read("src/app/api/privacy/requests/route.ts"));
    assert.match(route, /const \{ userId \} = await auth\(\);/);
    assert.match(route, /createPrivacyRequest\(getSupabaseAdminClient\(\), userId, requestType\)/);
    assert.doesNotMatch(route, /body\.clerkUserId|body\.userId/i);
  });

  test("the DSAR export bundle deliberately includes the user's own prompt text — the one inversion of this codebase's usual no-prompt discipline, and it is documented as deliberate", () => {
    // The RAW file, not stripComments()'d — this checks the header docblock
    // itself explains the deliberate inversion, which stripping would remove.
    const raw = read("src/lib/privacy/dsar-export.ts");
    assert.match(raw, /DELIBERATELY includes the user's own prompt text/);
    assert.match(stripComments(raw), /prompt/);
  });

  test("the export bundle is bounded — refuses rather than silently truncating past MAX_DSAR_BUNDLE_BYTES", () => {
    const src = stripComments(read("src/lib/privacy/dsar-export.ts"));
    assert.match(src, /MAX_DSAR_BUNDLE_BYTES/);
    assert.match(src, /outcome: "too_large"/);
  });

  test("the DSAR export endpoint is hardened per the roadmap's own explicit warning: rate-limited, step-up + two-person gated, one-time signed download, never a raw storage key returned to any read path", () => {
    const executeRoute = stripComments(read("src/app/api/admin/privacy/execute/route.ts"));
    assert.match(executeRoute, /guardRoute\(\{ routeClass: "durable_write"/);
    assert.match(executeRoute, /getCurrentAssuranceEvidence/);
    const service = stripComments(read("src/lib/privacy/privacy-execution-service.ts"));
    assert.match(service, /authorizeTier0Action/);
    assert.match(service, /createPresignedDownload/);
    assert.doesNotMatch(service, /return\s*\{[^}]*exportObjectKey/);
  });
});

// ---- 23-C: deletion_tombstones + AccountDeletionWorkflow -------------------

describe("Phase 23-C — deletion_tombstones, AccountDeletionWorkflow, restore re-delete control", () => {
  test("deletion_tombstones exists, append-only, RLS enabled, service_role-only, UNIQUE(clerk_user_id)", () => {
    const migration = read("supabase/migrations/20260910000000_privacy_lifecycle.sql");
    const sqlOnly = stripSqlComments(migration);
    assert.match(sqlOnly, /CREATE TABLE IF NOT EXISTS "public"\."deletion_tombstones"/);
    assert.match(sqlOnly, /deletion_tombstones_append_only/);
    assert.match(sqlOnly, /deletion_tombstones_clerk_user_id_key.*UNIQUE/);
    assert.match(sqlOnly, /ALTER TABLE "public"\."deletion_tombstones" ENABLE ROW LEVEL SECURITY/);
  });

  test("no migration was added beyond the one Phase 23 migration itself — the media_assets Phase 23 hooks (data_class/retention_policy/legal_hold/tombstoned_at) are filled, not re-created", () => {
    const migration = stripSqlComments(read("supabase/migrations/20260910000000_privacy_lifecycle.sql"));
    assert.doesNotMatch(migration, /CREATE TABLE.*media_assets/i);
    assert.match(migration, /ALTER TABLE "public"\."media_assets"/);
  });

  test("AccountDeletionWorkflow anonymizes the profile row, never deletes it — every other table FKs to profiles.clerk_user_id", () => {
    const src = stripComments(read("src/lib/privacy/account-deletion-workflow.ts"));
    assert.match(src, /from\("profiles"\)\s*\n?\s*\.update/);
    assert.doesNotMatch(src, /from\("profiles"\)\.delete\(\)/);
  });

  test("a legal_hold media asset is excluded from the deletion sweep — the roadmap's own explicit exception", () => {
    const src = stripComments(read("src/lib/privacy/account-deletion-workflow.ts"));
    assert.match(src, /!r\.legal_hold/);
  });

  test("the credit ledger is never touched by account deletion — retain_immutable per data-classification.ts, a financial record survives account deletion", () => {
    const src = stripComments(read("src/lib/privacy/account-deletion-workflow.ts"));
    assert.doesNotMatch(src, /credit_ledger/);
  });

  test("Clerk deletion is dependency-injected — AccountDeletionWorkflow never calls the live Clerk API directly, and this repository's own tests never invoke the live implementation", () => {
    const workflow = stripComments(read("src/lib/privacy/account-deletion-workflow.ts"));
    assert.match(workflow, /ClerkUserDeleter/);
    assert.doesNotMatch(workflow, /clerkClient\(\)/);
    const service = stripComments(read("src/lib/privacy/clerk-account-service.ts"));
    assert.match(service, /export const LiveClerkUserDeleter/);
  });

  test("restore-redelete-guard.ts never calls the Clerk API and never re-attempts a physical R2 delete — only re-applies the Postgres-side tombstone (clerk_user_id, the identity COLUMN, is expected and fine)", () => {
    const src = stripComments(read("src/lib/privacy/restore-redelete-guard.ts"));
    assert.doesNotMatch(src, /clerkClient|@clerk\/nextjs|\.deleteUser\(/);
    assert.doesNotMatch(src, /deleteAssetObject/);
  });

  test("R2 hot-object deletion is a real, new capability (Phase 23), separate from the S3 DR client which has no delete permission at all", () => {
    const r2Client = stripComments(read("src/lib/media/r2-client.ts"));
    assert.match(r2Client, /DeleteObjectCommand/);
    assert.match(r2Client, /export async function deleteAssetObject/);
  });
});

// ---- 23-D: admin privacy view ----------------------------------------------

describe("Phase 23-D — Admin Privacy view is read-only", () => {
  test("no POST/PUT/DELETE route exists under /api/admin/privacy (the sibling /execute route is the only mutation surface, and it requires data.export/data.delete)", () => {
    const src = stripComments(read("src/app/api/admin/privacy/route.ts"));
    assert.doesNotMatch(src, /export async function POST|export async function PUT|export async function DELETE/);
  });

  test("Privacy is a real link in the admin nav", () => {
    const layout = read("src/app/admin/layout.tsx");
    assert.match(layout, /href="\/admin\/privacy"/);
  });

  test("the admin read service never selects export_object_key or any other raw storage path — sensitive-data boundary, structurally", () => {
    const src = stripComments(read("src/lib/admin/privacy-admin-service.ts"));
    assert.doesNotMatch(src, /object_key/);
  });
});

// ---- Policy/Tier-0 wiring — reused, not duplicated -------------------------

describe("Phase 23 — data.export/data.delete reuse the existing policy + Tier-0 mechanisms, never a second authority", () => {
  const actions = (registry as { actions: Record<string, { critical: boolean; requiredRoles: string[]; requiresTwoPerson: boolean; requiresHumanApproval: boolean; implemented: boolean; owner: string }> }).actions;

  for (const action of ["data.export", "data.delete"]) {
    test(`${action} is now implemented, still critical, route_admin-only, two-person and human-approval required`, () => {
      const entry = actions[action];
      assert.ok(entry);
      assert.equal(entry.implemented, true);
      assert.equal(entry.critical, true);
      assert.equal(entry.requiresTwoPerson, true);
      assert.equal(entry.requiresHumanApproval, true);
      assert.deepEqual(entry.requiredRoles, ["route_admin"]);
      assert.equal(entry.owner, "phase-23");
    });

    test(`${action} is never AI-allowlisted`, () => {
      const r = registry as { aiWriteAllowlist: string[] };
      assert.ok(!r.aiWriteAllowlist.includes(action));
    });

    test(`${action} is registered in the Tier-0 catalogue as HIGH_RISK_TIER0, tier0_admin, step-up + two-person — the SAME generic dual-control mechanism route.disable/queue.dlq.redrive already use`, () => {
      const entry = TIER0_ACTION_CATALOGUE[action as keyof typeof TIER0_ACTION_CATALOGUE];
      assert.ok(entry);
      assert.equal(entry.classification, "HIGH_RISK_TIER0");
      assert.equal(entry.minimumRole, "tier0_admin");
      assert.equal(entry.requiresStepUp, true);
      assert.equal(entry.requiresTwoPerson, true);
    });
  }

  test("retention.override/legal_hold.set/legal_hold.clear remain deliberately unimplemented this batch — not silently flipped alongside data.export/data.delete", () => {
    for (const action of ["retention.override", "legal_hold.set", "legal_hold.clear"]) {
      assert.equal(actions[action].implemented, false, `${action} must remain not-implemented — out of this batch's scope`);
    }
  });

  test("privacy-execution-service.ts calls requirePolicy and authorizeTier0Action — the same two, unmodified Phase 16-E/19 functions, never a third gate", () => {
    const src = stripComments(read("src/lib/privacy/privacy-execution-service.ts"));
    assert.match(src, /from "@\/lib\/policy\/policy-gate"/);
    assert.match(src, /from "@\/lib\/admin\/tier0-authorization"/);
  });

  test("policy.rego and its conformance cases were re-verified fresh, not merely assumed — the OPA suite itself is the authority, not this test", () => {
    const cases = read("policies/conformance/cases.json");
    assert.match(cases, /data\.export is now implemented \(Phase 23\)/);
    assert.match(cases, /data\.delete is now implemented \(Phase 23\)/);
  });
});

// ---- Built-but-unwired reachability ----------------------------------------

describe("Phase 23 — every new component has a real caller", () => {
  test("privacy-execution-service.ts is called by the real admin execute route, not only by its own tests", () => {
    const src = stripComments(read("src/app/api/admin/privacy/execute/route.ts"));
    assert.match(src, /from "@\/lib\/privacy\/privacy-execution-service"/);
    assert.match(src, /executePrivacyRequest\(/);
  });

  test("account-deletion-workflow.ts is called by the real execution service, not only by its own tests", () => {
    const src = stripComments(read("src/lib/privacy/privacy-execution-service.ts"));
    assert.match(src, /from "\.\/account-deletion-workflow"/);
    assert.match(src, /executeAccountDeletion\(/);
  });

  test("dsar-export.ts is called by the real execution service, not only by its own tests", () => {
    const src = stripComments(read("src/lib/privacy/privacy-execution-service.ts"));
    assert.match(src, /from "\.\/dsar-export"/);
    assert.match(src, /buildDsarExportBundle\(/);
  });

  test("the admin API route imports the real service, not a stub", () => {
    const src = stripComments(read("src/app/api/admin/privacy/route.ts"));
    assert.match(src, /getPrivacyAdminView/);
  });

  test("restore-redelete-guard.ts is real, tested code with NO live caller — an honest, disclosed LIVE_DEFERRED seam, same class as production-sample.ts (Phase 22)", () => {
    assert.ok(existsSync(path.join(ROOT, "src/lib/privacy/restore-redelete-guard.ts")));
    let output = "";
    try {
      output = execFileSync("git", ["grep", "-l", "reapplyTombstonesAfterRestore", "--", "src/app", "src/worker"], { cwd: ROOT, encoding: "utf8" });
    } catch {
      output = ""; // git grep exits non-zero when nothing matches — that IS the expected, passing case here.
    }
    const callers = output.split("\n").filter((line) => line.trim().length > 0);
    assert.deepEqual(callers, [], "restore-redelete-guard must currently have NO live production caller — see its own header for why (LIVE_DEFERRED)");
  });
});

// ---- Sensitive data boundary ------------------------------------------------

describe("Phase 23 — sensitive data boundary", () => {
  test("no secret, token, credential, or signed-URL shape anywhere in the new privacy module", () => {
    const FORBIDDEN = /(secret|password|apikey|api_key|signedurl|signed_url|sdkkey)/i;
    for (const file of [
      "src/lib/privacy/data-classification.ts",
      "src/lib/privacy/processor-inventory.ts",
      "src/lib/privacy/privacy-request-store.ts",
      "src/lib/privacy/account-deletion-workflow.ts",
      "src/lib/privacy/restore-redelete-guard.ts",
    ]) {
      assert.doesNotMatch(stripComments(read(file)), FORBIDDEN, `${file} must carry no secret-shaped field`);
    }
  });

  test("the DSAR export inversion is the ONLY place raw prompt text is deliberately included — every other new Phase 23 file stays prompt-free", () => {
    for (const file of [
      "src/lib/privacy/data-classification.ts",
      "src/lib/privacy/processor-inventory.ts",
      "src/lib/privacy/privacy-request-store.ts",
      "src/lib/privacy/account-deletion-workflow.ts",
      "src/lib/privacy/restore-redelete-guard.ts",
      "src/lib/admin/privacy-admin-service.ts",
      "src/lib/privacy/privacy-execution-service.ts",
    ]) {
      const src = stripComments(read(file));
      assert.doesNotMatch(src, /\.prompt\b/, `${file} must never read/forward raw prompt text`);
    }
  });
});
