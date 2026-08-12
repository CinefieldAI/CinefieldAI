import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { projectCatalog } from "@/lib/orchestration/capability-projection";

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
 * NOT WIRED INTO /generate. The frozen Cinema Studio UI still carries its own
 * hardcoded capability lists, and AGENTS.md freezes that page absent an
 * explicit unlock, which this phase does not grant. The endpoint exists and is
 * correct; consuming it is a separate, explicitly-authorized change.
 *
 * Authenticated: the catalog is product surface, not public documentation, and
 * an unauthenticated caller has nothing to do with it.
 */

export async function GET(): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  // Pure, in-process, no database and no secrets — the registry is code.
  const models = projectCatalog();

  return NextResponse.json(
    { models },
    {
      // Capabilities change on deploy, not per request, but this must never be
      // served from a shared cache to the wrong tenant. Private only.
      headers: { "Cache-Control": "private, max-age=60" },
    }
  );
}
