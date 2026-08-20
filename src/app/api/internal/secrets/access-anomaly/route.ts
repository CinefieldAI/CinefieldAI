import { timingSafeEqual, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { OrchestrationError, toOrchestrationError } from "@/lib/orchestration/errors";
import { guardRoute, privateJson } from "@/lib/security/response-headers";
import { createFieldLogger } from "@/lib/observability/logger";
import { parseSecretAccessAnomalyReport } from "@/lib/secrets/secret-access-anomaly-contract";
import { recordSecurityEvent } from "@/lib/security/security-event-logger";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";

/**
 * POST /api/internal/secrets/access-anomaly — INTERNAL_ONLY (Phase 25-D).
 *
 * The receiving end of the CloudTrail->security.events bridge the roadmap
 * names: "KMS/secret erişimini CloudTrail/alerting ile izle; anormal
 * secret read/KMS decrypt davranışını security.events'e bağla." Mirrors
 * `/api/internal/infra/drift-report` (Phase 18-D) exactly — no Clerk
 * session is possible (the caller is a live EventBridge/Lambda forwarder,
 * not a browser), gated by a single shared secret compared in constant
 * time instead.
 *
 * FAIL CLOSED WHEN UNCONFIGURED: no
 * `CINEFIELD_SECRETS_ANOMALY_INGEST_TOKEN` means every request is refused.
 * There is no bypass mode.
 *
 * The actual EventBridge rule that would call this route in production is
 * `infra/modules/secrets-manager/`'s own Terraform — CODE_COMPLETE, never
 * applied by this batch. Today nothing calls this route live; it exists so
 * that decision, once made, activates a real mechanism rather than
 * requiring new code — the same "seam real, wiring deferred" shape
 * `retention-cleanup-executor.ts` (Phase 23) already established.
 */

const emit = createFieldLogger("secret-access-anomaly-report");

function readToken(): string | null {
  const raw = process.env.CINEFIELD_SECRETS_ANOMALY_INGEST_TOKEN;
  return typeof raw === "string" && raw.trim().length >= 32 ? raw.trim() : null;
}

/** Constant-time comparison — a naive `===` leaks match length/position through response timing. */
function safeTokenMatches(expected: string, provided: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

function authorize(request: Request): boolean {
  const configured = readToken();
  if (!configured) return false;

  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return false;
  const provided = header.slice("Bearer ".length).trim();
  if (provided.length === 0) return false;

  return safeTokenMatches(configured, provided);
}

export async function POST(request: Request): Promise<NextResponse> {
  const limited = await guardRoute({ routeClass: "durable_write", headers: request.headers });
  if (limited) return limited;

  if (!authorize(request)) {
    const error = new OrchestrationError("AUTH_REQUIRED");
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const error = new OrchestrationError("INVALID_INPUT", { userMessage: "Invalid request body." });
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  const parsed = parseSecretAccessAnomalyReport(body);
  if (!parsed.ok) {
    const error = new OrchestrationError("INVALID_INPUT", { userMessage: "Invalid anomaly report." });
    return privateJson({ ...error.toResponseBody(), reason: parsed.error }, { status: error.status });
  }

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ received: false, reason: "not_configured" }, { status: 503 });
  }

  try {
    const report = parsed.report;
    const result = await recordSecurityEvent(getSupabaseAdminClient(), {
      kind: "secret_access_anomaly",
      source: "kms_cloudtrail_bridge",
      reasonCode: report.reasonCode,
      // The IAM principal ARN CloudTrail attributed the read to — bounded,
      // never a secret value. Hashed rather than stored verbatim, matching
      // subjectHash's own documented "a hashed bucket, never an address"
      // discipline elsewhere in security_events.
      subjectHash: hashPrincipal(report.principalArn),
      resourceType: "secret",
      resourceId: report.secretName,
      tenantId: report.environment,
    });
    emit({
      op: "secret_access_anomaly_report",
      environment: report.environment,
      eventName: report.eventName,
      recorded: result.recorded,
    });
    return privateJson({ received: true }, { status: 200 });
  } catch (caught) {
    const error = toOrchestrationError(caught);
    return privateJson(error.toResponseBody(), { status: error.status });
  }
}

/** Bounded, one-way — never reversible back to the ARN, matching subjectHash's own contract elsewhere. */
function hashPrincipal(principalArn: string): string {
  return createHash("sha256").update(principalArn).digest("hex").slice(0, 32);
}
