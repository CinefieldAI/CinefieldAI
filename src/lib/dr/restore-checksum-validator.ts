import type {
  ChecksumItem,
  ChecksumItemResult,
  ChecksumOutcome,
  ChecksumValidation,
} from "./restore-evidence-contract";
import type { RestoreEvidenceSource } from "./restore-target";

/** A digest matching Phase 9-B's `checksum_sha256` shape: 64 lowercase hex characters. */
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Checksum validation (Phase 15-C/1).
 *
 * Reuses Phase 9-B's `checksum_sha256` as content identity — this module
 * computes no digest of its own over media bytes. The caller supplies
 * `expected` digests read from the canonical `media_assets` table; this
 * module compares them against what the restore target reports.
 *
 * ---------------------------------------------------------------------------
 * A MALFORMED DIGEST NEVER COMPARES EQUAL BY ACCIDENT
 * ---------------------------------------------------------------------------
 * Both the expected and the actual digest are shape-checked against the same
 * pattern the database CHECK constraint enforces. An empty string, a
 * truncated value, or a stray whitespace difference is rejected as
 * UNAVAILABLE rather than risking a string-equality quirk deciding a content
 * identity question.
 */
export async function validateChecksums(
  source: RestoreEvidenceSource,
  expected: readonly ChecksumItem[]
): Promise<ChecksumValidation> {
  const results: ChecksumItemResult[] = [];

  for (const item of expected) {
    if (!DIGEST_PATTERN.test(item.expectedDigest)) {
      results.push({ subjectId: item.subjectId, outcome: "UNAVAILABLE" });
      continue;
    }

    let actual: string | null;
    try {
      actual = await source.getActualChecksum(item.subjectId);
    } catch {
      actual = null;
    }

    if (actual === null || !DIGEST_PATTERN.test(actual)) {
      results.push({ subjectId: item.subjectId, outcome: "UNAVAILABLE", expectedDigest: item.expectedDigest });
      continue;
    }

    results.push({
      subjectId: item.subjectId,
      outcome: actual === item.expectedDigest ? "MATCH" : "MISMATCH",
      expectedDigest: item.expectedDigest,
      actualDigest: actual,
    });
  }

  return { overall: summarize(results), results };
}

function summarize(results: readonly ChecksumItemResult[]): ChecksumOutcome {
  if (results.length === 0) return "UNAVAILABLE";
  if (results.some((r) => r.outcome === "MISMATCH")) return "MISMATCH";
  if (results.some((r) => r.outcome === "UNAVAILABLE")) return "UNAVAILABLE";
  return "MATCH";
}
