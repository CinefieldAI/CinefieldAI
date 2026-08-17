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
 * is done; everything below remains labels only for later Phase 16 packages.
 */

const FUTURE_SECTIONS = [
  "Incidents",
  "Cost / FinOps",
  "Restore",
  "Recovery",
  "DLQ",
  "Providers / Routes",
] as const;

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
          {FUTURE_SECTIONS.map((label) => (
            <span key={label} className="cursor-not-allowed rounded px-2 py-1.5 text-neutral-600">
              {label}
            </span>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
