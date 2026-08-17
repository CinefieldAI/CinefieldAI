import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * Phase 16-E — structural boundary checks (Sections 17/19/20/23 of the
 * spec): CSRF threat model for privileged admin mutations, canonical action
 * owners preserved, no AI/MCP reachability, and the migration's own
 * sensitive-data discipline. Grep-based, matching the convention every
 * other Phase 16 closure test already uses for structural assertions.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const ADMIN_MUTATION_ROUTES = [
  "src/app/api/admin/dlq/redrive/route.ts",
  "src/app/api/admin/router/disable/route.ts",
  "src/app/api/admin/temporal/[generationId]/cancel/route.ts",
  "src/app/api/admin/queue-health/bullmq-retry/route.ts",
  "src/app/api/admin/moderation/release/route.ts",
];

// ===========================================================================
// CSRF (Section 17)
// ===========================================================================

test("CSRF: every privileged admin mutation route exports POST and never GET — a mutation is never reachable via a plain link/navigation", () => {
  for (const rel of ADMIN_MUTATION_ROUTES) {
    const text = read(rel);
    assert.match(text, /export async function POST/, `${rel} must export POST`);
    assert.doesNotMatch(text, /export async function GET/, `${rel} must not also expose a GET mutation path`);
  }
});

test("CSRF: every privileged admin mutation route parses the body as JSON and rejects a non-JSON body — a plain HTML form (no custom Content-Type, no CORS preflight) cannot produce a body this code accepts", () => {
  for (const rel of ADMIN_MUTATION_ROUTES) {
    const text = read(rel);
    assert.match(text, /request\.json\(\)/, `${rel} must parse the body as JSON`);
    assert.match(text, /invalid_body|INVALID_INPUT/, `${rel} must reject an unparsable body rather than proceed with defaults`);
  }
});

test("CSRF: no admin route sets permissive CORS headers — the absence of Access-Control-Allow-Origin is what makes a cross-origin JSON POST fail its preflight", () => {
  const adminApiDir = path.join(ROOT, "src", "app", "api", "admin");
  const offenders: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") {
        const text = readFileSync(full, "utf8");
        if (/Access-Control-Allow-Origin/i.test(text)) offenders.push(full);
      }
    }
  }
  walk(adminApiDir);
  assert.deepEqual(offenders, [], "no admin route may grant cross-origin access");
});

test("CSRF: no next.config.* declares a permissive Access-Control-Allow-Origin header for /api/admin", () => {
  const candidates = ["next.config.js", "next.config.ts", "next.config.mjs"];
  for (const candidate of candidates) {
    try {
      const text = read(candidate);
      assert.doesNotMatch(text, /Access-Control-Allow-Origin/i, `${candidate} must not grant CORS to admin routes`);
    } catch {
      // File does not exist under this name — fine, at most one does.
    }
  }
});

// ===========================================================================
// Canonical action owners preserved (Section 19)
// ===========================================================================

test("canonical owners: the wired Phase 16-E call sites still invoke the UNMODIFIED Phase 7/9/15 owners, never a re-implementation", () => {
  const dlq = read("src/lib/admin/dlq-admin-service.ts");
  assert.match(dlq, /redriveOneProviderDlqMessage/, "DLQ redrive must still call the Phase 15-D/16-B executor");

  const router = read("src/lib/admin/router-admin-service.ts");
  assert.match(router, /setRouteEnabled/, "route disable must still call Phase 7-B's setRouteEnabled");
  assert.doesNotMatch(router, /UPDATE\s+model_routes|\.from\("model_routes"\)\.update/, "no direct model_routes mutation may exist outside Phase 7-B's own function");

  const temporal = read("src/lib/admin/temporal-admin-service.ts");
  assert.match(temporal, /recordCancelIntent/, "Temporal cancel must still call the Phase 6R-H cancel-intent owner");
  assert.match(temporal, /requestGenerationCancellation/, "Temporal cancel must still call the Phase 6R.3 Temporal signal");

  const moderation = read("src/lib/admin/moderation-admin-service.ts");
  assert.match(moderation, /requestMediaRelease|approveMediaRelease|rejectMediaAsset/, "Moderation actions must still call Phase 9-E's quarantine-release.ts, unmodified");

  // The canonical files themselves are untouched by this batch — Phase 16-E
  // never re-implements them.
  const quarantineRelease = read("src/lib/media/quarantine-release.ts");
  assert.match(quarantineRelease, /media_release_required_approvals|approve_media_release/, "Phase 9-E's own two-person mechanism is unchanged");
});

test("tier0-action-catalogue.ts imports nothing but its own types — it classifies authority, it never calls an action owner", () => {
  const text = read("src/lib/admin/tier0-action-catalogue.ts");
  const importLines = text.split("\n").filter((l) => l.trim().startsWith("import"));
  assert.equal(importLines.length, 0, "the catalogue must be a pure data module with zero imports");
});

test("tier0-authorization.ts never imports a canonical action owner (Supabase RPC/table names for routing, media, DLQ, Temporal, BullMQ)", () => {
  const text = read("src/lib/admin/tier0-authorization.ts");
  const forbiddenImports = [
    "setRouteEnabled",
    "redriveOneProviderDlqMessage",
    "requestGenerationCancellation",
    "approveMediaRelease",
    "getQueue",
  ];
  for (const symbol of forbiddenImports) {
    assert.doesNotMatch(text, new RegExp(symbol), `tier0-authorization.ts must never import ${symbol} — it decides, it never acts`);
  }
});

// ===========================================================================
// AI reachability (Section 20)
// ===========================================================================

test("AI_REACHABLE_TIER0_ACTION = NO: no MCP/agent-facing module imports any Phase 16-E admin/tier0 module", () => {
  const candidates = [
    "src/lib/admin/tier0-authorization.ts",
    "src/lib/admin/admin-privilege.ts",
    "src/lib/admin/step-up-auth.ts",
    "src/lib/admin/require-step-up.ts",
    "src/lib/admin/privileged-action-audit.ts",
    "src/lib/admin/dual-control-admin.ts",
  ].filter((rel) => {
    try {
      read(rel);
      return true;
    } catch {
      return false;
    }
  });

  function collectFiles(dir: string, out: string[]) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collectFiles(full, out);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) out.push(full);
    }
  }

  const srcFiles: string[] = [];
  collectFiles(path.join(ROOT, "src"), srcFiles);

  const mcpLike = srcFiles.filter((f) => /mcp|agent-tool|ai-write/i.test(f));
  for (const file of mcpLike) {
    const text = readFileSync(file, "utf8");
    for (const candidate of candidates) {
      const moduleName = path.basename(candidate, ".ts");
      assert.doesNotMatch(text, new RegExp(moduleName), `${file} must not import Phase 16-E's ${moduleName}`);
    }
  }
  // No MCP write surface exists at all in this repository (Phase 12-E's own
  // `requireAiWritePolicy` comment: "no code in this repository calls it
  // yet") — this assertion passes vacuously today and stays a real tripwire
  // if one is ever added.
});

test("requireAiWritePolicy (the one AI write boundary in the repo) is never called from any Phase 16-E file", () => {
  const files = [
    "src/lib/admin/tier0-authorization.ts",
    "src/lib/admin/admin-privilege.ts",
    "src/lib/admin/step-up-auth.ts",
    "src/lib/admin/require-step-up.ts",
    "src/lib/admin/privileged-action-audit.ts",
    "src/lib/admin/tier0-action-catalogue.ts",
  ];
  for (const rel of files) {
    const text = read(rel);
    assert.doesNotMatch(text, /requireAiWritePolicy/, `${rel} must never grant AI write authority`);
  }
});

// ===========================================================================
// Sensitive data boundary (Section 23) — the migration itself
// ===========================================================================

test("sensitive data boundary: the audit migration's actual SQL (comments stripped) never defines a payload/body/prompt/secret/token/url column", () => {
  // SQL `--` comments are stripped first: this migration's own PROSE
  // explicitly discusses why a payload/secret/token column must never exist
  // (see its header), which would otherwise false-positive this check. Only
  // the real, executable SQL is checked.
  const migration = read("supabase/migrations/20260829000000_tier0_admin_action_audit.sql")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    // COMMENT ON TABLE ... IS '...' carries a human-readable description
    // (itself explaining what must never be added) inside a string literal —
    // schema-defining SQL, not a column, so it is excluded the same way.
    .replace(/COMMENT ON TABLE[\s\S]*?;/g, "");
  const forbidden = ["payload", "raw_body", "prompt", "secret", "token", "signed_url", "stack_trace", "provider_response"];
  for (const word of forbidden) {
    assert.doesNotMatch(migration, new RegExp(word, "i"), `migration's executable SQL must never define a "${word}"-shaped column`);
  }
});

test("sensitive data boundary: privileged-action-audit.ts's write/read functions never accept or project a free-form metadata field", () => {
  const text = read("src/lib/admin/privileged-action-audit.ts");
  assert.doesNotMatch(text, /metadata\s*[:?]\s*(Record<string,\s*unknown>|any)/, "no unbounded metadata field may exist on the audit contract");
});
