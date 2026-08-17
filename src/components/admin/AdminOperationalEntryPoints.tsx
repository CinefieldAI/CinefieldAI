import Link from "next/link";

/**
 * Phase 16-B dashboard completion — real entry points into the operational
 * surfaces (queue health, failed jobs, routing) that `AdminInvestigation-
 * EntryPoints.tsx` (Phase 16-A) does not cover. Kept as a separate section
 * rather than merged into that list: 16-A's entries are all
 * investigation-only (no action reachable from any of them), while every
 * entry here leads to a screen that can mutate durable state — the
 * distinction is real, not decorative, so the dashboard itself keeps it
 * visible rather than blending "look" and "act" into one undifferentiated
 * grid.
 */

const OPERATIONAL_ENTRY_POINTS: { href: string; label: string; description: string }[] = [
  {
    href: "/admin/dlq",
    label: "Failed Jobs / DLQ",
    description: "What is stuck in the provider DLQ, why, and is it safe to redrive?",
  },
  {
    href: "/admin/queue-health",
    label: "Queue Health",
    description: "Are the critical SQS command lane and auxiliary BullMQ lanes healthy?",
  },
  {
    href: "/admin/models-providers",
    label: "Models / Providers",
    description: "Which models and providers are configured and enabled?",
  },
  {
    href: "/admin/router",
    label: "Router Controls",
    description: "Which routes are active, and can an authorized operator disable one?",
  },
];

export default function AdminOperationalEntryPoints() {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Operational controls</h2>
      <p className="mb-4 text-xs text-neutral-500">
        These screens can mutate durable state (redrive a message, retry a job, disable a route) — each requires
        explicit confirmation and a reason, never a background/automatic action.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {OPERATIONAL_ENTRY_POINTS.map((entry) => (
          <Link key={entry.href} href={entry.href} className="rounded border border-neutral-800 p-3 hover:bg-neutral-900">
            <div className="mb-1 text-sm font-medium text-neutral-100">{entry.label}</div>
            <div className="text-xs text-neutral-500">{entry.description}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
