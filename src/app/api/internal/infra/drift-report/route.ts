import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { OrchestrationError, toOrchestrationError } from "@/lib/orchestration/errors";
import { guardRoute, privateJson } from "@/lib/security/response-headers";
import { createFieldLogger } from "@/lib/observability/logger";
import { parseDriftReport } from "@/lib/infra/drift-report-contract";
import { alertOnDriftReport } from "@/lib/infra/infra-alert-bridge";

/**
 * POST /api/internal/infra/drift-report — INTERNAL_ONLY (Phase 18-D).
 *
 * The one narrow seam an external drift-check runner (GitHub Actions —
 * this repository has no server-side Terraform execution, see
 * .github/workflows/infra-drift.yml) uses to hand a bounded drift
 * conclusion to the existing Phase 13-D alert authority. No Clerk session
 * is possible here (the caller is a CI job, not a browser), so this route
 * is deliberately NOT `auth()`-gated — it is gated by a single shared
 * secret instead, compared in constant time so response latency cannot
 * leak how much of a guess matched.
 *
 * FAIL CLOSED WHEN UNCONFIGURED: no `CINEFIELD_INFRA_DRIFT_INGEST_TOKEN`
 * means every request is refused — the same "absent configuration denies"
 * rule this codebase applies to every admin-bootstrap allowlist. There is
 * no bypass mode.
 *
 * This route mutates nothing about generation, billing, or admin
 * authority — it can only add an entry to the existing, in-memory alert
 * dedupe map or resolve one. It creates no new database table (see
 * docs/operations/INFRA_EMERGENCY_RUNBOOK.md for why durable infra-audit
 * evidence stays with the GitHub Actions run itself rather than a new
 * migration).
 */

const emit = createFieldLogger("infra-drift-report");

function readToken(): string | null {
  const raw = process.env.CINEFIELD_INFRA_DRIFT_INGEST_TOKEN;
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
  // Reuses the shared rate-limit boundary (durable_write: mutates durable
  // alert state, no provider cost) with no userId — this caller has none.
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

  const parsed = parseDriftReport(body);
  if (!parsed.ok) {
    const error = new OrchestrationError("INVALID_INPUT", { userMessage: "Invalid drift report." });
    return privateJson({ ...error.toResponseBody(), reason: parsed.error }, { status: error.status });
  }

  try {
    const outcome = alertOnDriftReport(parsed.report);
    // Codes only — never the workflow run URL or commit SHA, both of which
    // are already durable in the GitHub Actions run this evidence came
    // from and don't need a second copy in application logs.
    emit({
      op: "drift_report",
      environment: parsed.report.environment,
      status: parsed.report.status,
      alertRaised: outcome !== null,
    });
    return privateJson({ received: true }, { status: 200 });
  } catch (caught) {
    const error = toOrchestrationError(caught);
    return privateJson(error.toResponseBody(), { status: error.status });
  }
}
