import { createHash } from "node:crypto";
import type { DurableTable, RowCountItem } from "./restore-evidence-contract";

/**
 * Deterministic digest of a row-count manifest (Phase 15-C/1).
 *
 * Plain `node:crypto`, not the Phase 9-B sandboxed inspector. The sandbox
 * exists because media bytes are UNTRUSTED external input handed to a
 * process that could hang or crash; a row-count manifest is OUR OWN
 * structured data, built from numbers this process already computed, so it
 * needs no isolation — only a stable serialization.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAKES THIS CANONICAL
 * ---------------------------------------------------------------------------
 * Sorted by table name, one line per entry, and NOTHING ELSE goes into the
 * hash: no timestamp, no restoreId, no free-text. A capture time is real
 * information but not part of the DATA being verified — including it would
 * make two identical restores of the same backup produce different digests
 * depending on when validation happened to run, which defeats the point of
 * a content digest.
 */
export function canonicalRowCountManifest(items: readonly RowCountItem[]): string {
  const sorted = [...items].sort((a, b) => a.table.localeCompare(b.table));
  return sorted.map((item) => `${item.table}=${item.rowCount}`).join("\n");
}

export function computeRowCountManifestDigest(items: readonly RowCountItem[]): string {
  return sha256Hex(canonicalRowCountManifest(items));
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** True when every table in `items` is unique — a manifest cannot double-count a table. */
export function hasUniqueTables(items: readonly RowCountItem[]): boolean {
  const seen = new Set<DurableTable>();
  for (const item of items) {
    if (seen.has(item.table)) return false;
    seen.add(item.table);
  }
  return true;
}
