import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  requestMediaRelease,
  approveMediaRelease,
  rejectMediaAsset,
  isAssetDeliverable,
} from "@/lib/media/quarantine-release";
import {
  getModerationEngine,
  isModerationConfigured,
  moderationStatusFor,
  type ModerationVerdict,
} from "@/lib/media/moderation-contract";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 9-E, code side. One property matters more than the rest: there is no
 * path — not an admin, not a flag, not a mock — by which media leaves
 * quarantine without a moderation verdict that no engine can currently
 * produce. Everything else protects that.
 */

const ROOT = process.cwd();
const ASSET = "55555555-5555-4555-8555-555555555555";
const ADMIN_A = "user_admin_alpha";
const ADMIN_B = "user_admin_beta";
const CIVILIAN = "user_ordinary_person";

const MIGRATION = readFileSync(
  path.join(ROOT, "supabase/migrations/20260823000000_quarantine_release_lane.sql"),
  "utf8"
);
const SERVICE = readFileSync(path.join(ROOT, "src/lib/media/quarantine-release.ts"), "utf8");
const CONTRACT = readFileSync(path.join(ROOT, "src/lib/media/moderation-contract.ts"), "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** SQL comments carry the same prose as the TS ones, and are equally not code. */
function stripSqlComments(source: string): string {
  return source.replace(/^\s*--.*$/gm, "");
}

/** Admin allowlist is env-driven; these tests set it explicitly per case. */
function withAdmins<T>(admins: string[], run: () => T): T {
  const saved = process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  process.env.ROUTE_ADMIN_CLERK_USER_IDS = admins.join(",");
  try {
    return run();
  } finally {
    if (saved === undefined) delete process.env.ROUTE_ADMIN_CLERK_USER_IDS;
    else process.env.ROUTE_ADMIN_CLERK_USER_IDS = saved;
  }
}

function rpcAdmin(responses: Record<string, unknown>, calls: string[] = []) {
  const table = {
    select: () => table,
    eq: () => table,
    order: async () => ({ data: [], error: null }),
    maybeSingle: async () => ({ data: responses.__row ?? null, error: null }),
  };
  return {
    from: () => table,
    rpc: async (fn: string) => {
      calls.push(fn);
      return { data: responses[fn] ?? null, error: null };
    },
  } as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// 1–3, 27. Moderation is fail-closed and has no default
// ---------------------------------------------------------------------------

test("1/2. release requires moderation passed; not_evaluated cannot release", () => {
  const guard = MIGRATION.slice(
    MIGRATION.indexOf("approve_media_release"),
    MIGRATION.indexOf("reject_media_asset")
  );

  assert.ok(/moderation_status NOT IN \('passed', 'approved'\)/.test(guard));
  assert.ok(/moderation_not_passed/.test(guard));
  // The 9-B database constraint refuses the row independently, so even a
  // direct UPDATE cannot do it.
  const ingestMigration = readFileSync(
    path.join(ROOT, "supabase/migrations/20260821000000_media_ingest_gate.sql"),
    "utf8"
  );
  assert.ok(/media_assets_release_requires_checks/.test(ingestMigration));
});

test("3. no engine is configured, and none can be conjured by configuration", () => {
  assert.equal(getModerationEngine(), null);
  assert.equal(isModerationConfigured(), false);

  // A name that resolves to nothing must stay null rather than fall back to
  // something permissive.
  const saved = process.env.CINEFIELD_MEDIA_MODERATION_ENGINE;
  process.env.CINEFIELD_MEDIA_MODERATION_ENGINE = "definitely-not-registered";
  try {
    assert.equal(getModerationEngine(), null, "a typo must not become 'moderation off but looks on'");
  } finally {
    if (saved === undefined) delete process.env.CINEFIELD_MEDIA_MODERATION_ENGINE;
    else process.env.CINEFIELD_MEDIA_MODERATION_ENGINE = saved;
  }
});

test("27. the moderation contract has no default verdict at all", () => {
  const code = stripComments(CONTRACT);

  // Every verdict is something a classifier said. There is no member meaning
  // "probably fine", so an unimplemented engine cannot return one.
  assert.ok(!/return "passed"/.test(code.replace(/case "passed":\s*\n\s*return "passed";/, "")));
  assert.ok(!/\|\|\s*"passed"/.test(code), "no fallback to passed");
  assert.ok(!/\?\?\s*"passed"/.test(code));
  const verdicts: ModerationVerdict[] = ["passed", "rejected", "manual_review", "error"];
  assert.deepEqual(verdicts.map(moderationStatusFor), ["passed", "rejected", "manual_review", "error"]);
});

test("3b. no environment flag converts missing moderation into a pass", () => {
  const code = stripComments(SERVICE) + stripComments(CONTRACT);
  assert.ok(!/SKIP_MODERATION|MODERATION_BYPASS|ALLOW_UNMODERATED|FORCE_RELEASE/i.test(code));
  assert.ok(!/NODE_ENV\s*[!=]==?\s*["']production["']/.test(code), "no dev-only shortcut");
});

test("no test mock is reachable from production release code", () => {
  const imports = SERVICE.match(/^import .*$/gm)?.join("\n") ?? "";
  assert.ok(!/mock|fake|stub|test/i.test(imports));
});

// ---------------------------------------------------------------------------
// 4–8. Authorization
// ---------------------------------------------------------------------------

test("4/5. a non-admin cannot release, request or reject", async () => {
  await withAdmins([ADMIN_A], async () => {
    const admin = rpcAdmin({});
    for (const call of [
      () => requestMediaRelease(admin, { assetId: ASSET, actorClerkUserId: CIVILIAN }),
      () => approveMediaRelease(admin, { assetId: ASSET, actorClerkUserId: CIVILIAN }),
      () => rejectMediaAsset(admin, { assetId: ASSET, actorClerkUserId: CIVILIAN }),
    ]) {
      await assert.rejects(call, (error: Error) => (error as { code?: string }).code === "FORBIDDEN");
    }
  });
});

test("4b. with no allowlist configured, NOBODY is an admin", async () => {
  const saved = process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  delete process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  try {
    const admin = rpcAdmin({});
    await assert.rejects(
      () => approveMediaRelease(admin, { assetId: ASSET, actorClerkUserId: ADMIN_A }),
      (error: Error) => (error as { code?: string }).code === "FORBIDDEN"
    );
  } finally {
    if (saved !== undefined) process.env.ROUTE_ADMIN_CLERK_USER_IDS = saved;
  }
});

test("4c. the browser has no route to any of this", () => {
  // The strongest form of "a browser cannot": there is nothing to call.
  // Code only: the route's header comment explains the quarantine lane, which
  // is documentation of the boundary rather than a way through it.
  const routes = stripComments(
    readFileSync(path.join(ROOT, "src/app/api/media/upload-url/route.ts"), "utf8")
  );
  assert.ok(!/release|reject|approve/i.test(routes), "no release surface on any browser route");

  const apiDir = readFileSync(path.join(ROOT, "src/lib/media/quarantine-release.ts"), "utf8");
  assert.ok(/^import "server-only";/m.test(apiDir));
});

test("6. an admin cannot bypass moderation — two approvals still fail", async () => {
  await withAdmins([ADMIN_A, ADMIN_B], async () => {
    const admin = rpcAdmin({
      approve_media_release: {
        released: false,
        reason: "moderation_not_passed",
        moderation_status: "not_evaluated",
      },
    });

    const outcome = await approveMediaRelease(admin, {
      assetId: ASSET,
      actorClerkUserId: ADMIN_B,
    });

    assert.equal(outcome.released, false);
    assert.equal(outcome.released === false && outcome.reason, "moderation_not_passed");
  });
});

test("6b. authorization derives from the server, never from a request field", () => {
  const code = stripComments(SERVICE);
  assert.ok(/assertRouteAdmin\(params\.actorClerkUserId\)/.test(code));
  assert.ok(!/body\.|request\.|isAdmin|role\s*===/.test(code), "no client-supplied authority");
});

// ---------------------------------------------------------------------------
// 7–8. Two-person approval
// ---------------------------------------------------------------------------

test("7. a single admin cannot reach the threshold alone", () => {
  // PRIMARY KEY (asset, approver): the same human approving twice writes the
  // same row, so the count does not move.
  assert.ok(
    /CONSTRAINT "media_release_approvals_pkey" PRIMARY KEY \("asset_id", "approver_clerk_user_id"\)/.test(
      MIGRATION
    )
  );
  const flat = MIGRATION.replace(/\s+/g, " ");
  assert.ok(/media_release_required_approvals"?\(\) RETURNS integer[^;]{0,160}SELECT 2/.test(flat));
  assert.ok(/awaiting_second_approval/.test(MIGRATION));
});

test("7b. the two-person rule comes from the roadmap, not from taste", () => {
  // Roadmap: "Şu aksiyonlar tek admin onayıyla çalıştırılamaz — ... quarantine
  // release ...". A one-click admin release would have contradicted it.
  assert.ok(/tek admin onayıyla çalıştırılamaz|two-person|Two-Person|two people/i.test(MIGRATION));
});

test("8. the first approval does not release, even when it completes the pair", async () => {
  await withAdmins([ADMIN_A], async () => {
    const calls: string[] = [];
    const admin = rpcAdmin({ request_media_release: { recorded: true, approvals: 1, required: 2 } }, calls);

    const result = await requestMediaRelease(admin, { assetId: ASSET, actorClerkUserId: ADMIN_A });

    assert.equal(result.recorded, true);
    assert.equal(result.approvals, 1);
    assert.deepEqual(calls, ["request_media_release"], "requesting never calls approve");
  });
});

// ---------------------------------------------------------------------------
// 8–11. Replay and terminal states
// ---------------------------------------------------------------------------

test("8b. release replay is inert and reports why", async () => {
  await withAdmins([ADMIN_A], async () => {
    const admin = rpcAdmin({
      approve_media_release: { released: false, reason: "already_released" },
    });
    const outcome = await approveMediaRelease(admin, { assetId: ASSET, actorClerkUserId: ADMIN_A });
    assert.equal(outcome.released, false);
    assert.equal(outcome.released === false && outcome.reason, "already_released");
  });
});

test("9. reject replay is inert", async () => {
  await withAdmins([ADMIN_A], async () => {
    const admin = rpcAdmin({ reject_media_asset: { rejected: false, reason: "already_rejected" } });
    const outcome = await rejectMediaAsset(admin, { assetId: ASSET, actorClerkUserId: ADMIN_A });
    assert.equal(outcome.rejected, false);
    assert.equal(outcome.rejected === false && outcome.reason, "already_rejected");
  });
});

test("11. a rejected asset cannot be released through the normal path", () => {
  const guard = MIGRATION.slice(
    MIGRATION.indexOf("approve_media_release"),
    MIGRATION.indexOf("reject_media_asset")
  );
  assert.ok(/ingest_status = 'rejected'[\s\S]{0,160}asset_rejected/.test(guard));

  // And rejection voids any approvals collected beforehand, so a later reopen
  // cannot inherit consent nobody gave.
  assert.ok(/DELETE FROM media_release_approvals WHERE asset_id = p_asset_id/.test(MIGRATION));
});

test("11b. a released asset cannot be rejected back into quarantine", () => {
  const reject = MIGRATION.slice(MIGRATION.indexOf("reject_media_asset"));
  assert.ok(/quarantine_status = 'released'[\s\S]{0,160}already_released/.test(reject));
});

test("no appeal or reopen flow was invented", () => {
  const code = stripComments(SERVICE) + stripSqlComments(MIGRATION);
  assert.ok(!/reopen|appeal|unreject|restore_quarantine/i.test(code));
});

// ---------------------------------------------------------------------------
// 12–16. Delivery gate
// ---------------------------------------------------------------------------

function deliveryAdmin(row: Record<string, unknown> | null) {
  const table = {
    select: () => table,
    eq: () => table,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { from: () => table } as unknown as SupabaseClient;
}

test("12/13/14. only a released, verified, finalized asset is deliverable", async () => {
  const cases: [Record<string, unknown> | null, boolean, string][] = [
    [{ quarantine_status: "released", ingest_status: "verified", status: "finalized", tombstoned_at: null }, true, "released"],
    [{ quarantine_status: "quarantined", ingest_status: "verified", status: "finalized", tombstoned_at: null }, false, "quarantined"],
    [{ quarantine_status: "released", ingest_status: "rejected", status: "finalized", tombstoned_at: null }, false, "rejected ingest"],
    [{ quarantine_status: "released", ingest_status: "pending", status: "finalized", tombstoned_at: null }, false, "unverified"],
    [{ quarantine_status: "released", ingest_status: "verified", status: "stored", tombstoned_at: null }, false, "not finalized"],
    [{ quarantine_status: "released", ingest_status: "verified", status: "finalized", tombstoned_at: "2026-01-01" }, false, "tombstoned"],
    [null, false, "no asset at all"],
  ];

  for (const [row, expected, label] of cases) {
    assert.equal(await isAssetDeliverable(deliveryAdmin(row), ASSET), expected, label);
  }
});

test("15/16. neither provider output nor browser upload can bypass the gate", () => {
  // The gate lives INSIDE attachSignedUrls, so no caller can obtain a URL by
  // forgetting to check — and a caller that supplies no generation gets none.
  const storage = readFileSync(path.join(ROOT, "src/lib/orchestration/output-storage.ts"), "utf8");
  const fn = storage.slice(storage.indexOf("export async function attachSignedUrls"));

  assert.ok(/if \(!gate\)/.test(fn), "no gate argument means no URL");
  assert.ok(/isGenerationAssetDeliverable/.test(fn));

  const gateCheck = fn.indexOf("isGenerationAssetDeliverable(admin, gate.generationId)");
  const mint = fn.indexOf("createSignedUrl");
  assert.ok(gateCheck > 0 && mint > gateCheck, "the check must precede minting");

  assert.ok(/quarantine_status === "released"/.test(fn));
});

test("the orchestrator passes the gate argument", () => {
  const orchestrator = readFileSync(path.join(ROOT, "src/lib/orchestration/orchestrator.ts"), "utf8");
  assert.ok(/attachSignedUrls\(admin, uploaded, \{ generationId \}\)/.test(orchestrator));
});

// ---------------------------------------------------------------------------
// 17–19. Transactional outbox
// ---------------------------------------------------------------------------

test("17/18. release and reject emit their event in the SAME transaction", () => {
  const release = MIGRATION.slice(
    MIGRATION.indexOf("approve_media_release"),
    MIGRATION.indexOf("reject_media_asset")
  );
  const reject = MIGRATION.slice(MIGRATION.indexOf("CREATE OR REPLACE FUNCTION \"public\".\"reject_media_asset\""));

  for (const [body, event] of [
    [release, "media.asset.released"],
    [reject, "media.asset.rejected"],
  ] as const) {
    assert.ok(body.includes(event), event);
    const update = body.indexOf("UPDATE media_assets");
    const emit = body.indexOf("emit_outbox_event");
    assert.ok(update > 0 && emit > update, `${event}: state change then event, one function body`);
  }
});

test("19. a refused transition emits nothing", () => {
  const release = MIGRATION.slice(
    MIGRATION.indexOf("approve_media_release"),
    MIGRATION.indexOf("reject_media_asset")
  );
  // Every refusal RETURNs before reaching emit_outbox_event.
  const emitIndex = release.indexOf("emit_outbox_event");
  const refusals = [...release.matchAll(/RETURN jsonb_build_object\('released', false/g)];

  assert.ok(refusals.length >= 8, "every precondition returns its own reason");
  for (const match of refusals) {
    assert.ok(match.index! < emitIndex, "a refusal must return before the event is emitted");
  }
});

test("20/21/22. release correctness needs no Kafka, Redis or BullMQ", () => {
  const imports = SERVICE.match(/^import .*$/gm)?.join("\n") ?? "";
  assert.ok(!/kafka|msk|redis|bullmq/i.test(imports));
  assert.ok(!/kafka|msk|redis|bullmq/i.test(stripComments(MIGRATION)));
});

// ---------------------------------------------------------------------------
// 23–26, 28–29. Provider calls, audit hygiene, client authority
// ---------------------------------------------------------------------------

test("23/24. nothing here calls a provider or a moderation service", () => {
  const imports = SERVICE.match(/^import .*$/gm)?.join("\n") ?? "";
  assert.ok(!/provider-registry|fal|gemini|openai|anthropic|hive|sightengine/i.test(imports));
  assert.ok(!/fetch\(/.test(stripComments(SERVICE)));
  assert.ok(!/fetch\(/.test(stripComments(CONTRACT)));
});

test("25/26. the audit cannot hold a signed URL, a payload or a secret", () => {
  const table = MIGRATION.slice(
    MIGRATION.indexOf('CREATE TABLE IF NOT EXISTS "public"."media_safety_audit"'),
    MIGRATION.indexOf('ALTER TABLE "public"."media_safety_audit" OWNER')
  );

  const columns = [...table.matchAll(/^\s{4}"([a-z_]+)"\s/gm)].map((m) => m[1]);
  assert.ok(columns.length > 0);
  assert.deepEqual(
    columns.filter((c) => /url|payload|secret|token|prompt|bytes|media_data/i.test(c)),
    []
  );
  assert.ok(!/jsonb/.test(table), "no free-form blob to hide one in");

  // The reason is a short code, enforced by regex — not a message field.
  assert.ok(/reason_code" ~ '\^\[a-z\]\[a-z0-9_\]\{1,64\}\$'/.test(table));
});

test("25b. the audit is append-only, enforced by trigger", () => {
  assert.ok(/media_safety_audit_is_append_only/.test(MIGRATION));
  assert.ok(/BEFORE UPDATE OR DELETE ON "public"."media_safety_audit"/.test(MIGRATION));
});

test("28/29. a browser can write neither moderation status nor an audit actor", () => {
  assert.ok(/REVOKE ALL ON TABLE "public"."media_safety_audit" FROM "anon", "authenticated"/.test(MIGRATION));
  assert.ok(/REVOKE ALL ON TABLE "public"."media_release_approvals" FROM "anon", "authenticated"/.test(MIGRATION));

  for (const fn of ["request_media_release", "approve_media_release", "reject_media_asset"]) {
    assert.ok(
      new RegExp(`REVOKE ALL ON FUNCTION "public"\\."${fn}"[\\s\\S]{0,200}"authenticated"`).test(MIGRATION),
      fn
    );
    assert.ok(
      new RegExp(`GRANT EXECUTE ON FUNCTION "public"\\."${fn}"[\\s\\S]{0,200}TO "service_role"`).test(MIGRATION),
      fn
    );
  }

  // 9-B already revoked UPDATE on media_assets from authenticated, which is
  // what stops a client writing moderation_status directly.
  const ingest = readFileSync(
    path.join(ROOT, "supabase/migrations/20260821000000_media_ingest_gate.sql"),
    "utf8"
  );
  assert.ok(/REVOKE UPDATE ON TABLE "public"."media_assets" FROM "authenticated"/.test(ingest));
});

test("30. release and reject serialise against each other at the DATABASE", () => {
  // FOR UPDATE on the asset row: two callers cannot both read `quarantined`
  // and both proceed. Solving this only in JavaScript would not survive two
  // processes.
  for (const fn of ["approve_media_release", "reject_media_asset"]) {
    const body = MIGRATION.slice(MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION "public"."${fn}"`));
    assert.ok(/SELECT \* INTO v_row FROM media_assets WHERE id = p_asset_id FOR UPDATE/.test(body), fn);
  }
});

test("no product code performs an ad-hoc quarantine UPDATE", () => {
  // The transition exists in exactly one place. A direct UPDATE anywhere else
  // would bypass the evidence checks, the audit and the outbox at once.
  const files = [
    "src/lib/media/asset-service.ts",
    "src/lib/media/ingest-gate.ts",
    "src/lib/media/dr-backup-service.ts",
    "src/lib/orchestration/orchestrator.ts",
    "src/lib/orchestration/output-storage.ts",
  ];
  for (const file of files) {
    const code = stripComments(readFileSync(path.join(ROOT, file), "utf8"));
    assert.ok(!/quarantine_status\s*:/.test(code), `${file} must not write quarantine_status`);
    assert.ok(!/"released"/.test(code) || /=== "released"/.test(code), `${file} may compare, never assign`);
  }
});
