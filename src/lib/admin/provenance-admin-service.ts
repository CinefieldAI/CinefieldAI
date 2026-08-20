import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { currentProvenanceSigner } from "@/lib/provenance/content-signer";
import { MARKED_STATES, type ProvenanceMarkingState } from "@/lib/provenance/provenance-contract";
import type { ProvenanceAdminResult, ProvenanceRow } from "./provenance-admin-contract";

const MAX_ROWS = 100;

/**
 * The Phase 27-D admin provenance read service — "işaretlenmiş çıktı oranı".
 *
 * A plain read, matching `game-day-admin-service.ts`'s own "not a second
 * authority" discipline. The denominator is `media_assets` rows that reached
 * `finalized` — the only status the roadmap's Phase 9 treats as a real,
 * completed output, so the ratio answers "what fraction of delivered output
 * carries provenance" rather than counting pending or failed rows that were
 * never eligible for marking.
 *
 * `embeddingPipelineAvailable` is a hardcoded `false` and says why: no
 * FFmpeg/media-worker step exists to embed into (Phase 9-C). Computing it
 * from anything would imply a capability check that has nothing to check.
 */
export async function getProvenanceAdminView(admin: SupabaseClient): Promise<ProvenanceAdminResult> {
  try {
    const totalQuery = await admin
      .from("media_assets")
      .select("id", { count: "exact", head: true })
      .eq("status", "finalized");
    if (totalQuery.error) {
      return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "media_assets_count_failed" };
    }
    const totalFinalizedAssets = totalQuery.count ?? 0;

    const { data, error } = await admin
      .from("media_provenance")
      .select(
        "media_asset_id, generation_id, marking_state, digital_source_type, verified_mime, format_support, signature, signer_key_id, disclosure_requirement, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);
    if (error) return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "media_provenance_read_failed" };

    const rows = (data ?? []) as Record<string, unknown>[];

    const recent: ProvenanceRow[] = rows.map((row) => ({
      mediaAssetId: row.media_asset_id as string,
      generationId: (row.generation_id as string | null) ?? null,
      markingState: row.marking_state as ProvenanceMarkingState,
      digitalSourceType: row.digital_source_type as ProvenanceRow["digitalSourceType"],
      verifiedMime: row.verified_mime as string,
      formatSupport: row.format_support as string,
      // Presence only. The signature never leaves the server.
      signed: typeof row.signature === "string" && (row.signature as string).length > 0,
      signerKeyId: (row.signer_key_id as string | null) ?? null,
      disclosureRequirement: row.disclosure_requirement as ProvenanceRow["disclosureRequirement"],
      createdAt: row.created_at as string,
    }));

    const markedAssets = rows.filter((r) => MARKED_STATES.has(r.marking_state as ProvenanceMarkingState)).length;
    const signedAssets = recent.filter((r) => r.signed).length;
    const embeddedC2paAssets = rows.filter((r) => r.marking_state === "EMBEDDED_C2PA").length;

    return {
      outcome: "FOUND",
      view: {
        coverage: {
          totalFinalizedAssets,
          markedAssets,
          signedAssets,
          // Never fabricate 1.0 (or 0) out of an empty set — an undefined
          // ratio is reported as `null`, the same way RECOVERED_NO_TARGET
          // (Phase 15-D/2) refuses to imply a met target that never existed.
          markedRatio:
            totalFinalizedAssets > 0
              ? Math.round((markedAssets / totalFinalizedAssets) * 10_000) / 10_000
              : null,
          embeddedC2paAssets,
        },
        recent,
        embeddingPipelineAvailable: false,
        signerConfigured: currentProvenanceSigner().keyId !== null,
      },
    };
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "provenance_admin_read_failed" };
  }
}
