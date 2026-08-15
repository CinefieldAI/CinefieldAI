import { NextResponse } from "next/server";
import { guardRoute, privateJson } from "@/lib/security/response-headers";
import { liveness } from "@/lib/health/health-service";

/**
 * GET /api/health/live — public liveness.
 *
 * The one health surface exposed over HTTP, and it is deliberately the least
 * informative one. Roadmap ¶649 / ¶1698 give Better Stack "harici uptime,
 * synthetic, heartbeat ve public status" in 13-C; an external monitor needs to
 * know the process answers, and nothing more.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT DO
 * ---------------------------------------------------------------------------
 * It performs NO dependency check. Not as an optimisation — as the contract.
 * Liveness that touched Redis would let a Redis blip fail every container's
 * probe at once, and an orchestrator answers a failed liveness by restarting.
 * That converts a dependency incident into an application outage. Readiness is
 * where dependencies belong, because it removes a container from rotation
 * instead of killing it.
 *
 * ---------------------------------------------------------------------------
 * WHY READINESS IS NOT A ROUTE
 * ---------------------------------------------------------------------------
 * `readiness()` and `dependencyHealth()` are server-only functions with no
 * endpoint. An unauthenticated readiness endpoint enumerates which subsystems
 * are unwell — which database, which queue, which cache — and that is a map of
 * the architecture plus a list of what is currently weakest. 12-D reached the
 * same conclusion for `configurationHealth()` and left it unrouted.
 *
 * When 13-C needs more than liveness from outside, the answer is an
 * authenticated internal route or a push heartbeat, decided then. It is not
 * this file quietly growing a `?verbose=1`.
 *
 * ---------------------------------------------------------------------------
 * RESPONSE
 * ---------------------------------------------------------------------------
 * `{ "status": "HEALTHY", "timestamp": "..." }` — no version, no build id, no
 * region, no runtime name, no dependency. A monitor needs 200 and a body it
 * can match; everything beyond that is disclosure with no consumer.
 *
 * ---------------------------------------------------------------------------
 * IT OBEYS THE SAME RULES AS EVERY OTHER ROUTE
 * ---------------------------------------------------------------------------
 * The first version of this file skipped `guardRoute` and returned a raw
 * `NextResponse.json`, on the argument that a liveness probe should never be
 * refused and carries nothing private. PRE-12's structural guards rejected it
 * immediately — correctly. An endpoint that opts out of the rate limiter and
 * the cache contract is an exemption, and an exemption is how those guards
 * stop meaning anything.
 *
 * So the route did not get an exception; the POLICY TABLE got a class.
 * `public_health` is anonymous, generous (240/min — an uptime monitor uses
 * two) and fails OPEN, which resolves the original concern properly: a
 * monitor is never 429'd into reporting a false outage, and a Redis outage
 * cannot make liveness fail and trigger a restart storm.
 *
 * `privateJson` gives `private, no-store`. "Private" is harmless on a body
 * that is a constant plus a clock reading, and `no-store` is exactly what
 * this needs: a CDN-cached liveness response is a monitor watching a cache
 * instead of a process.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request): Promise<NextResponse> {
  const limited = await guardRoute({ routeClass: "public_health", headers: request.headers });
  if (limited) return limited;

  return privateJson(liveness());
}
