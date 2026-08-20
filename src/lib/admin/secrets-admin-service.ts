import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SECRET_REGISTRY, SENSITIVE_CLASSES } from "@/lib/config/secret-registry";
import { resolveEnvironment } from "@/lib/config/environment";
import { secretProviderKind } from "@/lib/config/secret-access";
import type { SecretsAdminResult, SecretLifecycleRow } from "./secrets-admin-contract";
import type { RotationState } from "@/lib/secrets/rotation-contract";

/**
 * The Phase 25-D admin Secrets Lifecycle read service.
 *
 * A PLAIN READ, matching `privacy-admin-service.ts`'s own "not a second
 * authority" discipline: `SECRET_REGISTRY` is read straight from its
 * source-controlled module (Phase 12-D, unchanged), `secret_rotations` is
 * read straight from its table (Phase 25-C). Only entries in
 * `SENSITIVE_CLASSES` (SERVER_SECRET/INFRA_SECRET/PROVIDER_SECRET) are
 * shown — PUBLIC/IDENTIFIER_NON_SECRET/LOCAL_ONLY names are not credentials
 * and clutter a lifecycle view meant to answer "what needs rotating".
 */
export async function getSecretsAdminView(admin: SupabaseClient): Promise<SecretsAdminResult> {
  try {
    const environment = resolveEnvironment();
    const { data, error } = await admin
      .from("secret_rotations")
      .select("secret_name, state, rotated_at, expires_at, verified_at, reason_code")
      .eq("environment", environment);

    if (error) return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "secret_rotations_read_failed" };

    const rotationByName = new Map(
      ((data ?? []) as { secret_name: string; state: RotationState; rotated_at: string | null; expires_at: string | null; verified_at: string | null; reason_code: string }[]).map(
        (row) => [row.secret_name, row]
      )
    );

    const secrets: SecretLifecycleRow[] = SECRET_REGISTRY.filter((entry) => SENSITIVE_CLASSES.has(entry.class)).map((entry) => {
      const rotation = rotationByName.get(entry.name);
      return {
        name: entry.name,
        class: entry.class,
        requirement: entry.requirement,
        group: entry.group,
        rotationClass: entry.rotation,
        note: entry.note,
        state: rotation?.state ?? "NOT_CONFIGURED",
        lastRotatedAt: rotation?.rotated_at ?? null,
        expiresAt: rotation?.expires_at ?? null,
        verifiedAt: rotation?.verified_at ?? null,
        reasonCode: rotation?.reason_code ?? null,
      };
    });

    return {
      outcome: "FOUND",
      view: { environment, secrets, secretManagerBackend: secretProviderKind() },
    };
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "secrets_admin_read_failed" };
  }
}
