import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

const clerkProxy = clerkMiddleware();

/**
 * Whether this process is a developer's machine.
 *
 * The logic mirrors `resolveEnvironment()` in `src/lib/config/environment.ts`
 * but is INLINED on purpose: middleware runs in the Edge runtime and is the
 * one module that must stay dependency-light, and importing a `server-only`
 * module here would couple every request to that module's import graph.
 *
 * It fails CLOSED. `VERCEL_ENV` is set on every Vercel deployment — production
 * AND preview — so its mere presence proves this is not a local machine and
 * ends the check immediately. Anything explicitly named production or staging
 * ends it too. Only a process with no deployment marker at all can be local.
 */
function isLocalDevelopment(): boolean {
  if (process.env.VERCEL_ENV !== undefined) return false;
  const declared = process.env.CINEFIELD_ENV;
  if (declared === "production" || declared === "staging") return false;
  return process.env.NODE_ENV !== "production";
}

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  // ---- LOCAL PREVIEW BYPASS — DEVELOPMENT ONLY ----------------------------
  //
  // This flag skips Clerk for the whole matcher, which is every page in the
  // app. It exists so the UI can be previewed without an auth session on a
  // local machine.
  //
  // The environment condition is what makes it safe, and it was added after a
  // review found the gap. `CINEFIELD_LOCAL_PREVIEW` is registered LOCAL_ONLY
  // in `secret-registry.ts` and `validateConfiguration()` refuses it in
  // production — but NOTHING CALLS that validator in the web tier (the three
  // long-lived workers do; a serverless function has no startup to hook). So
  // the control existed and never ran, which is the same built-but-unwired
  // shape this repository has closed four times.
  //
  // The realistic incident it prevents: someone copies `.env.example` — where
  // this name appears — into a Vercel project's environment variables, and
  // every page silently loses authentication with nothing reporting it.
  //
  // The API is not what this protects. Twelve of the fourteen API routes call
  // `auth()` themselves and answer 401 without a user id; the two that do not
  // are the `public_dev_stub` endpoints, which are anonymous by design. What
  // the bypass opens is the PAGE surface, and that is worth closing.
  if (process.env.CINEFIELD_LOCAL_PREVIEW === "1" && isLocalDevelopment()) {
    return NextResponse.next();
  }
  return clerkProxy(request, event);
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|cur|heic|heif|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
