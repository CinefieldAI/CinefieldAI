import type { ReactNode } from "react";
import Link from "next/link";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";

/**
 * Phase 16 Admin Operations Center shell (Phase 16/1).
 *
 * ---------------------------------------------------------------------------
 * THE ADMIN AUTHORIZATION GATE LIVES HERE, ONCE
 * ---------------------------------------------------------------------------
 * `requireAdminAccess()` is called exactly here, in the layout that wraps
 * every `/admin/*` page. A denied caller never reaches `children` — nothing
 * under this route tree, now or later, needs to repeat this check.
 *
 * ---------------------------------------------------------------------------
 * NOT ADDED TO PRODUCT NAVIGATION
 * ---------------------------------------------------------------------------
 * Nothing in `/generate`, `/audio`, `/marketing-studio`, `/supercomputer`, or
 * `/image` links here. This surface is reachable by direct URL only, exactly
 * as the Phase 16 master audit recommended for a first slice.
 *
 * ---------------------------------------------------------------------------
 * NAVIGATION IS LABELS, NOT ROUTES, FOR EVERYTHING NOT BUILT YET
 * ---------------------------------------------------------------------------
 * Workspaces / Risk / Incidents / Cost / Restore / Recovery / DLQ / Providers
 * are named here so the shell's shape is future-proof, but none of them is a
 * working link — building the nav entry is not building the screen.
 * "Generations" became a real link in Phase 16-A/2, "Users" in Phase 16-A/3,
 * "Workspace / Project" in Phase 16-A/4, "Risk" in the Phase 16-A closure
 * batch (labelled that way, not bare "Workspaces" for the projects screen —
 * the roadmap concept reconciles to `public.projects`, see
 * `workspace-investigation-contract.ts`'s header). With Risk added, every
 * screen the official 16-A package names (Dashboard, Users, Workspace/
 * Project, Risk, Generations/Attempts/Traces) is a real link — 16-A itself
 * is done. Phase 16-B adds "Failed Jobs / DLQ", "Queue Health", "Models /
 * Providers", and "Router Controls" as real links. Phase 16-C adds
 * "Billing / Credits", "Assets / Storage", and "Moderation" — deliberately
 * NOT "Cost / FinOps": that label names Phase 15-B's operational cost
 * ESTIMATE, which 16-C intentionally never merges with Phase 10's economic
 * ledger truth (see `billing-admin-contract.ts`'s header), so it stayed a
 * label until this batch built it as its own, clearly-separate screen.
 *
 * Phase 16-D adds five real links, matching the IA grouping in the 16-D
 * spec section 4: "Temporal / Workflows" (inspect + the one guarded cancel
 * action), "Security Center" (Phase 12/13 evidence, system-wide), "Incidents
 * / Audit" (Phase 13-D's live alert state, honestly ephemeral, plus the
 * Phase 12-E/9-E durable audit trails), "SLO / Cost Guard" (Phase 15-A/15-B
 * reused, not reimplemented), and "Deploy / Restore Health" (Phase 14-D
 * rollback signal + Phase 15-C restore verification + Phase 15-D RTO/RPO,
 * each honestly scoped to what real evidence exists). No further
 * placeholder labels remain — every screen the Phase 16-A/B/C/D packages
 * name is now a real link. 16-E's own future sections are not anticipated
 * here.
 *
 * Phase 21-B adds "Feature Flags" — the generic runtime kill-switch/
 * release-stage screen. Deliberately NOT a second "Router Controls" —
 * provider/model/route kill switches stay on that existing link; this one
 * covers only `maintenance_mode`, `feature.video.enabled`,
 * `uploads.enabled`, and `release_stage`.
 *
 * Phase 22-D adds "Model Quality" — the golden-dataset quality/cost/latency
 * comparison per active route. Read-only; no mutation surface exists on it,
 * matching "SLO / Cost Guard"'s own shape.
 */

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const access = await requireAdminAccess();

  if (!access.allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-100">
        <p className="text-sm text-neutral-400">Access denied.</p>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen bg-neutral-950 text-neutral-100">
      <aside className="w-56 shrink-0 border-r border-neutral-800 p-4">
        <h1 className="text-sm font-semibold tracking-wide text-neutral-200">Operations Center</h1>
        <nav className="mt-6 flex flex-col gap-1 text-sm">
          <Link href="/admin" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            System Health
          </Link>
          <Link href="/admin/generations" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Generations
          </Link>
          <Link href="/admin/users" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Users
          </Link>
          <Link href="/admin/workspaces" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Workspace / Project
          </Link>
          <Link href="/admin/risk" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Risk
          </Link>
          <Link href="/admin/dlq" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Failed Jobs / DLQ
          </Link>
          <Link href="/admin/queue-health" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Queue Health
          </Link>
          <Link href="/admin/models-providers" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Models / Providers
          </Link>
          <Link href="/admin/router" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Router Controls
          </Link>
          <Link href="/admin/feature-flags" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Feature Flags
          </Link>
          <Link href="/admin/model-quality" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Model Quality
          </Link>
          <Link href="/admin/privacy" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Privacy
          </Link>
          <Link href="/admin/secrets" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Secrets / Rotation
          </Link>
          <Link href="/admin/game-day" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Chaos / Game Day
          </Link>
          <Link href="/admin/provenance" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Provenance / AI Marking
          </Link>
          <Link href="/admin/billing" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Billing / Credits
          </Link>
          <Link href="/admin/assets" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Assets / Storage
          </Link>
          <Link href="/admin/moderation" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Moderation
          </Link>
          <Link href="/admin/temporal" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Temporal / Workflows
          </Link>
          <Link href="/admin/security-center" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Security Center
          </Link>
          <Link href="/admin/incidents" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Incidents / Audit
          </Link>
          <Link href="/admin/slo-cost" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            SLO / Cost Guard
          </Link>
          <Link href="/admin/deploy-restore" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Deploy / Restore Health
          </Link>
          <Link href="/admin/privileged-audit" className="rounded px-2 py-1.5 text-neutral-100 hover:bg-neutral-900">
            Privileged Action Audit
          </Link>
        </nav>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
