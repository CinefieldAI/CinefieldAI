import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  queryPrivilegedActionAudit,
  recordPrivilegedActionEvent,
  PRIVILEGED_AUDIT_MAX_ROWS,
} from "@/lib/admin/privileged-action-audit";
import { interpretPrivilegedAuditResponse, networkErrorState } from "@/lib/admin/privileged-audit-client-state";
import { FakeSupabaseClient } from "./fake-supabase";

/**
 * Phase 16-E — the bounded Privileged Action Audit query (Section 14): no
 * arbitrary SQL, no unbounded history, only narrow equality/time-window
 * filters. Also covers the client-state mapping the panel uses.
 */

test("queryPrivilegedActionAudit: filters by actor, action type, target id and event independently", async () => {
  const db = new FakeSupabaseClient();
  const admin = db as never;

  await recordPrivilegedActionEvent(admin, {
    requestId: randomUUID(),
    event: "requested",
    actorClerkUserId: "user_a",
    actionType: "queue.dlq.redrive",
    targetType: "dlq_message",
    targetId: "msg-1",
    securityClassification: "HIGH_RISK_TIER0",
  });
  await recordPrivilegedActionEvent(admin, {
    requestId: randomUUID(),
    event: "denied",
    actorClerkUserId: "user_b",
    actionType: "route.disable",
    targetType: "model_route",
    targetId: "route-1",
    securityClassification: "HIGH_RISK_TIER0",
  });

  const byActor = await queryPrivilegedActionAudit(admin, { actorClerkUserId: "user_a" });
  assert.equal(byActor.outcome, "FOUND");
  if (byActor.outcome !== "FOUND") return;
  assert.equal(byActor.rows.length, 1);
  assert.equal(byActor.rows[0].actorClerkUserId, "user_a");

  const byAction = await queryPrivilegedActionAudit(admin, { actionType: "route.disable" });
  assert.equal(byAction.outcome, "FOUND");
  if (byAction.outcome !== "FOUND") return;
  assert.equal(byAction.rows.length, 1);
  assert.equal(byAction.rows[0].targetId, "route-1");

  const byEvent = await queryPrivilegedActionAudit(admin, { event: "denied" });
  assert.equal(byEvent.outcome, "FOUND");
  if (byEvent.outcome !== "FOUND") return;
  assert.equal(byEvent.rows.length, 1);
  assert.equal(byEvent.rows[0].event, "denied");

  const byTarget = await queryPrivilegedActionAudit(admin, { targetId: "msg-1" });
  assert.equal(byTarget.outcome, "FOUND");
  if (byTarget.outcome !== "FOUND") return;
  assert.equal(byTarget.rows.length, 1);
});

test("queryPrivilegedActionAudit: sensitive-data boundary — no forbidden field can appear because none exists on the row shape", async () => {
  const db = new FakeSupabaseClient();
  const admin = db as never;
  await recordPrivilegedActionEvent(admin, {
    requestId: randomUUID(),
    event: "requested",
    actorClerkUserId: "user_a",
    actionType: "queue.dlq.redrive",
    targetType: "dlq_message",
    targetId: "msg-1",
    reasonCode: "incident_investigation",
    securityClassification: "HIGH_RISK_TIER0",
  });
  const result = await queryPrivilegedActionAudit(admin, {});
  assert.equal(result.outcome, "FOUND");
  if (result.outcome !== "FOUND") return;
  const row = result.rows[0] as unknown as Record<string, unknown>;
  const forbidden = ["prompt", "payload", "body", "token", "secret", "signedUrl", "stack", "rawResponse"];
  for (const key of forbidden) {
    assert.equal(Object.prototype.hasOwnProperty.call(row, key), false, `row must never carry a "${key}" field`);
  }
});

test("queryPrivilegedActionAudit: PRIVILEGED_AUDIT_MAX_ROWS is a real, positive, bounded ceiling", () => {
  assert.ok(PRIVILEGED_AUDIT_MAX_ROWS > 0);
  assert.ok(PRIVILEGED_AUDIT_MAX_ROWS <= 500);
});

test("client-state: interpretPrivilegedAuditResponse covers denied/unavailable/found and networkErrorState", () => {
  assert.deepEqual(interpretPrivilegedAuditResponse(404, { error: "not_found" }), { kind: "denied" });
  assert.deepEqual(
    interpretPrivilegedAuditResponse(200, { outcome: "SOURCE_UNAVAILABLE", reasonCode: "not_configured" }),
    { kind: "unavailable", reasonCode: "not_configured" }
  );
  const found = { outcome: "FOUND" as const, rows: [] };
  assert.deepEqual(interpretPrivilegedAuditResponse(200, found), { kind: "found", result: found });
  assert.deepEqual(networkErrorState(), { kind: "unavailable", reasonCode: "network_error" });
});
