import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * THE delivery gate — one implementation, per ASSET (Phase 9-E, Phase 28).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS SEPARATELY
 * ---------------------------------------------------------------------------
 * The predicate itself was written by Phase 9-E and lived in
 * `quarantine-release.ts`, alongside the admin release lane. That file imports
 * the policy gate, the route-admin allowlist and the security signal emitter —
 * everything a human release action needs and nothing a delivery check does.
 * Pulling all of it into the storage layer (and into the Next.js route that
 * mints a URL) to ask one yes/no question would drag the admin layer into
 * both.
 *
 * So the predicate MOVED here and `quarantine-release.ts` re-exports it. There
 * is still exactly ONE implementation — this one — which is what the "no
 * second delivery authority" rule requires. Splitting it into two copies that
 * agree today is how they stop agreeing later.
 *
 * ---------------------------------------------------------------------------
 * PER ASSET, NOT PER GENERATION
 * ---------------------------------------------------------------------------
 * Phase 27 and the Phase 9 multi-output batch gave every output its own asset
 * row, its own R2 object, its own provenance record and its own
 * `quarantine_status`. Phase 28 completes that: safety is decided per output
 * too, so delivery is asked per output.
 *
 * The generation-wide form is kept below for the callers that genuinely ask a
 * generation-wide question (completion), but delivery must not use it. Under
 * the generation-wide rule an unsafe sibling withheld its safe siblings —
 * conservative, but wrong in the other direction: a user who generated four
 * images and had one flagged would receive none of them, and there is no
 * roadmap rule requiring generation-wide blocking.
 */

interface GateRow {
  quarantine_status?: string;
  ingest_status?: string;
  status?: string;
  tombstoned_at?: string | null;
}

/**
 * The predicate, applied to one already-read row.
 *
 * `released` is the only state that qualifies. Quarantined, rejected, failed,
 * unverified, moderation-pending: all of them mean not yet.
 */
function rowIsDeliverable(row: GateRow | null): boolean {
  if (!row) return false;
  if (row.tombstoned_at) return false;
  return (
    row.quarantine_status === "released" &&
    row.ingest_status === "verified" &&
    row.status === "finalized"
  );
}

/**
 * Whether ONE asset may be served.
 *
 * Asked immediately before any user-facing URL is minted, and answered by the
 * database rather than by a cached flag — a stale `true` here would serve
 * media that was rejected a second ago.
 */
export async function isAssetDeliverable(admin: SupabaseClient, assetId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("media_assets")
    .select("quarantine_status,ingest_status,status,tombstoned_at")
    .eq("id", assetId)
    .maybeSingle();

  if (error) return false;
  return rowIsDeliverable(data as GateRow | null);
}

/**
 * Which of a generation's canonical outputs may be served, keyed by output
 * index.
 *
 * ONE query for the whole batch rather than N — a four-image generation would
 * otherwise make four round-trips to answer four questions the database can
 * answer together — while still yielding an INDEPENDENT answer per output. A
 * missing index is absent from the map, and callers treat absent as "not
 * deliverable" rather than defaulting it in.
 */
export async function deliverableOutputIndexes(
  admin: SupabaseClient,
  generationId: string
): Promise<Map<number, boolean>> {
  const result = new Map<number, boolean>();

  const { data, error } = await admin
    .from("media_assets")
    .select("output_index,quarantine_status,ingest_status,status,tombstoned_at")
    .eq("generation_id", generationId)
    .eq("role", "original");

  if (error) return result;

  for (const row of (data ?? []) as (GateRow & { output_index?: number })[]) {
    const index = typeof row.output_index === "number" ? row.output_index : 0;
    result.set(index, rowIsDeliverable(row));
  }

  return result;
}
