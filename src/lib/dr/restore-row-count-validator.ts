import { computeRowCountManifestDigest, hasUniqueTables } from "./restore-canonical-digest";
import { isDurableTable } from "./restore-evidence-contract";
import type {
  RowCountItem,
  RowCountItemResult,
  RowCountOutcome,
  RowCountValidation,
} from "./restore-evidence-contract";
import type { RestoreEvidenceSource } from "./restore-target";

/**
 * Row-count validation (Phase 15-C/1).
 *
 * Pure orchestration over the injected source's `getActualRowCount`. No
 * database driver, no Supabase client — the caller already resolved
 * "expected" counts from the canonical application database and hands them
 * in; this module only compares.
 *
 * ---------------------------------------------------------------------------
 * OVERALL OUTCOME: MISMATCH BEATS UNAVAILABLE BEATS MATCH
 * ---------------------------------------------------------------------------
 * A proven mismatch is reported even when another table's read failed,
 * because "table X definitely lost rows" is the more actionable fact and
 * must not be suppressed by an unrelated read failure. But the reverse never
 * happens: an unreadable table can never be silently treated as matching,
 * so `overall` is `MATCH` only when every single expected table was read AND
 * agreed.
 */
export async function validateRowCounts(
  source: RestoreEvidenceSource,
  expected: readonly RowCountItem[]
): Promise<RowCountValidation> {
  const expectedManifestDigest = computeRowCountManifestDigest(expected);

  const invalid = expected.find((item) => !isDurableTable(item.table));
  if (invalid || !hasUniqueTables(expected)) {
    // A caller error, not a restore-target problem: the expected list itself
    // is malformed. Reported as UNAVAILABLE rather than thrown, because the
    // engine's contract is "never throw on an expected operational state",
    // and a malformed manifest is exactly the kind of input this module must
    // not silently tolerate by ignoring the bad entry.
    return { overall: "UNAVAILABLE", results: [], expectedManifestDigest };
  }

  const results: RowCountItemResult[] = [];
  const actualItems: RowCountItem[] = [];

  for (const item of expected) {
    let actual: number | null;
    try {
      actual = await source.getActualRowCount(item.table);
    } catch {
      actual = null;
    }

    if (actual === null) {
      results.push({ table: item.table, outcome: "UNAVAILABLE", expected: item.rowCount });
      continue;
    }

    actualItems.push({ table: item.table, rowCount: actual });
    results.push({
      table: item.table,
      outcome: actual === item.rowCount ? "MATCH" : "MISMATCH",
      expected: item.rowCount,
      actual,
    });
  }

  const overall = summarize(results);
  // The actual-side digest is only meaningful when every table was read —
  // a digest built from a partial set would compare unlike things.
  const actualManifestDigest =
    actualItems.length === expected.length ? computeRowCountManifestDigest(actualItems) : undefined;

  return {
    overall,
    results,
    expectedManifestDigest,
    ...(actualManifestDigest !== undefined ? { actualManifestDigest } : {}),
  };
}

function summarize(results: readonly RowCountItemResult[]): RowCountOutcome {
  if (results.length === 0) return "UNAVAILABLE";
  if (results.some((r) => r.outcome === "MISMATCH")) return "MISMATCH";
  if (results.some((r) => r.outcome === "UNAVAILABLE")) return "UNAVAILABLE";
  return "MATCH";
}
