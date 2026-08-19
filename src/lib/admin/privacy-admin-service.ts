import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DATA_CLASSIFICATION_MATRIX } from "@/lib/privacy/data-classification";
import { PROCESSOR_INVENTORY } from "@/lib/privacy/processor-inventory";
import type { PrivacyAdminResult } from "./privacy-admin-contract";
import { toPrivacyRequestRow } from "@/lib/privacy/privacy-request-store";

/**
 * The Phase 23-D admin Privacy read service.
 *
 * A PLAIN READ, matching `model-quality-admin-service.ts`'s own
 * "not a second authority" discipline: the classification matrix and
 * processor inventory are read straight from their source-controlled
 * modules, and `privacy_requests`/`deletion_tombstones` are read straight
 * from their tables — nothing here computes a second opinion or mutates
 * anything. Satisfies 23-D's own done-criterion: "Audit edilen processor/
 * data-region görünürlüğü var" (auditable processor/data-region
 * visibility exists).
 */
export async function getPrivacyAdminView(admin: SupabaseClient): Promise<PrivacyAdminResult> {
  try {
    const [requestsResult, tombstoneResult] = await Promise.all([
      admin
        .from("privacy_requests")
        .select("id, clerk_user_id, request_type, status, tier0_request_id, requested_at, resolved_at, resolved_by, reason_code, export_expires_at")
        .order("requested_at", { ascending: false })
        .limit(50),
      admin.from("deletion_tombstones").select("id", { count: "exact", head: true }),
    ]);

    if (requestsResult.error) return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "privacy_requests_read_failed" };

    const recentRequests = ((requestsResult.data ?? []) as Record<string, unknown>[]).map(toPrivacyRequestRow);

    return {
      outcome: "FOUND",
      view: {
        dataClassification: DATA_CLASSIFICATION_MATRIX,
        processors: PROCESSOR_INVENTORY,
        recentRequests,
        tombstoneCount: tombstoneResult.count ?? 0,
      },
    };
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "privacy_admin_read_failed" };
  }
}
