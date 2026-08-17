import type { PrivilegedActionEvent, PrivilegedActionAuditRow } from "./privileged-action-audit";

/**
 * Phase 16-E — the bounded Privileged Action Audit read contract (Section
 * 14). Answers "who performed or requested which privileged action,
 * against what target, when, and with what result?" with bounded filters
 * only — never arbitrary SQL, never unbounded history (see
 * `PRIVILEGED_AUDIT_MAX_ROWS` in `privileged-action-audit.ts`).
 */

export const PRIVILEGED_AUDIT_EVENTS: readonly PrivilegedActionEvent[] = [
  "requested",
  "denied",
  "awaiting_second_approval",
  "approved",
  "rejected",
  "executed",
  "execution_failed",
  "expired",
];

export function isPrivilegedActionEvent(value: string | null): value is PrivilegedActionEvent {
  return value !== null && (PRIVILEGED_AUDIT_EVENTS as readonly string[]).includes(value);
}

export type PrivilegedAuditResult =
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "FOUND"; readonly rows: readonly PrivilegedActionAuditRow[] };
