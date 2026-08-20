import "server-only";

/**
 * Mandatory reporting seam (Phase 28-B).
 *
 * ---------------------------------------------------------------------------
 * WHAT THE ROADMAP ASKS FOR, AND WHAT A CODE BATCH CAN HONESTLY BUILD
 * ---------------------------------------------------------------------------
 * Phase 28's task list: "Quarantine + hesap bloklama + zorunlu raporlama
 * (NCMEC vb.) + audit." The quarantine and the audit are code. The REPORT is
 * not, and pretending otherwise would be the single most dangerous thing this
 * package could do.
 *
 * NCMEC's CyberTipline requires a registered Electronic Service Provider
 * account, and the report itself carries legal weight: filing one is a legal
 * act performed by an accountable entity, and — for a company established in
 * Austria/EU — WHICH authority is even the correct recipient is a question
 * for counsel, not for a module. There is no endpoint here, no credential, no
 * payload builder, and no protocol implementation.
 *
 * ---------------------------------------------------------------------------
 * REPORT_SUBMITTED IS UNREACHABLE WITHOUT A REAL REPORTER
 * ---------------------------------------------------------------------------
 * That is enforced structurally: the only code that can produce
 * `REPORT_SUBMITTED` is the branch that received a confirmation from an
 * INSTALLED reporter, and nothing installs one. A state machine whose
 * "submitted" state is reachable by default is a state machine that will
 * eventually report a fabricated submission into an audit an investigator is
 * reading.
 *
 * What this seam DOES do is make the obligation visible and durable:
 * `REPORT_REQUIRED` is a real, recorded outcome, so an unreported positive
 * match shows up as an outstanding obligation rather than as nothing at all.
 */

export type MandatoryReportOutcome =
  /** No reporter is installed. The obligation stands and is UNMET. */
  | { readonly outcome: "REPORTING_NOT_CONFIGURED" }
  /** A reporter exists; this case requires a report that has not been filed. */
  | { readonly outcome: "REPORT_REQUIRED"; readonly reporterName: string }
  /** A real reporter confirmed a filing. Reachable ONLY through one. */
  | { readonly outcome: "REPORT_SUBMITTED"; readonly reporterName: string; readonly referenceId: string }
  /** A reporter was asked and failed. The obligation still stands. */
  | { readonly outcome: "REPORT_FAILED"; readonly reporterName: string; readonly reasonCode: string };

/**
 * What a real reporting integration must implement.
 *
 * The input is deliberately minimal — an asset id and a bounded category. The
 * material itself is not passed: preserving and transmitting it is governed by
 * law and by the receiving authority's own procedure, and a seam that took
 * bytes would invite an implementation that emails them.
 */
export interface MandatoryReporter {
  readonly name: string;
  submit(input: {
    readonly mediaAssetId: string;
    readonly category: "csam";
    readonly listId: string | null;
  }): Promise<{ readonly submitted: boolean; readonly referenceId?: string } | null>;
}

let reporter: MandatoryReporter | null = null;

/** Installs a reporter, or clears it. Not called in production wiring. */
export function installMandatoryReporter(next: MandatoryReporter | null): void {
  reporter = next;
}

export function isMandatoryReportingConfigured(): boolean {
  return reporter !== null;
}

/**
 * Files, or records that a filing is owed.
 *
 * Never throws, and never reports success it did not receive. Note that every
 * failure path returns an outcome in which the obligation is still outstanding
 * — there is no member of this union that means "no longer required".
 */
export async function reportMandatoryCase(input: {
  readonly mediaAssetId: string;
  readonly category: "csam";
  readonly listId: string | null;
}): Promise<MandatoryReportOutcome> {
  const active = reporter;
  if (!active) return { outcome: "REPORTING_NOT_CONFIGURED" };

  let answer: Awaited<ReturnType<MandatoryReporter["submit"]>>;
  try {
    answer = await active.submit(input);
  } catch {
    return { outcome: "REPORT_FAILED", reporterName: active.name, reasonCode: "reporter_threw" };
  }

  if (answer === null) return { outcome: "REPORT_REQUIRED", reporterName: active.name };
  if (answer.submitted !== true) {
    return { outcome: "REPORT_FAILED", reporterName: active.name, reasonCode: "reporter_declined" };
  }

  const referenceId =
    typeof answer.referenceId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(answer.referenceId)
      ? answer.referenceId
      : null;

  // A submission without a usable reference is not evidence of a submission.
  if (!referenceId) {
    return { outcome: "REPORT_FAILED", reporterName: active.name, reasonCode: "missing_reference_id" };
  }

  return { outcome: "REPORT_SUBMITTED", reporterName: active.name, referenceId };
}
