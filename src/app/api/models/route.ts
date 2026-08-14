import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { projectCatalog } from "@/lib/orchestration/capability-projection";
import { resolveCatalogAvailability } from "@/lib/orchestration/model-availability";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";

import { guardRoute, privateJson } from "@/lib/security/response-headers";
/**
 * GET /api/models — the server's answer to "what can this model do?"
 * (Phase 7-F).
 *
 * This is the endpoint that makes the capability registry a single source of
 * truth rather than an aspiration. The server already validates every
 * generation against `ModelRegistryEntry.capabilities`; this serves the
 * PROJECTION of that same data, so a UI built from this response cannot offer
 * a setting the server will reject.
 *
 * WHAT IS NOT HERE, AND WHY
 * No provider id, no provider model id, no route, no priority, no cost. Where
 * a model runs is a routing decision (Phase 7-B) that belongs entirely to the
 * server; publishing it would let a client form an opinion about a provider
 * and would leak the commercial shape of the platform. `projectCatalog()`
 * enforces this by construction — it builds its output field by field instead
 * of spreading the registry entry.
 *
 * PRODUCTION AVAILABILITY IS RUNTIME (Phase 8). Capabilities change with a
 * deploy; whether a model can actually run changes with the route table. So
 * this endpoint answers both, and the build-time catalog answers only the
 * first. `productionAvailable` is derived from the SAME hard eligibility the
 * router applies — never from a second implementation — and it carries no
 * provider, route, score or durability internals with it.
 *
 * Authenticated: the catalog is product surface, not public documentation, and
 * an unauthenticated caller has nothing to do with it.
 */

export async function GET(): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return privateJson({ error: "Authentication required." }, { status: 401 });
  }

  // Phase 12-A (application half). BEFORE any side effect: the handler
  // has not begun, so a refusal cannot have called a provider or written
  // anything durable.
  const limited = await guardRoute({ routeClass: "authenticated_read", userId });
  if (limited) return limited;

  // Pure, in-process, no database and no secrets — the registry is code.
  const catalog = projectCatalog();

  // Live availability, from the real route table. Without a configured admin
  // client there is nothing to query, so every model falls back to its STATIC
  // readiness — which understates availability rather than overstating it.
  // Overstating is the direction that puts a user in front of a model that
  // will refuse them.
  const availability = isSupabaseAdminConfigured()
    ? await resolveCatalogAvailability(getSupabaseAdminClient())
    : null;

  const models = catalog.map((model) => {
    const resolved = availability?.get(model.id);
    const productionAvailability =
      resolved?.availability ?? (model.productionReady ? "available" : "not_production_ready");

    return {
      ...model,
      // Product-level only. The internal rejection reasons stay server-side:
      // "this model is not available" is a product fact, "gemini has unproven
      // execution durability" is not the browser's business.
      productionAvailability,
      productionAvailable: productionAvailability === "available",
    };
  });

  return privateJson(
    { models },
    {
      // Capabilities change on deploy, not per request, but this must never be
      // served from a shared cache to the wrong tenant. Private only.
      headers: { "Cache-Control": "private, max-age=60" },
    }
  );
}
