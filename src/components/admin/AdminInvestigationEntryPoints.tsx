import Link from "next/link";

/**
 * Phase 16-A dashboard completion — "where do I start an investigation?"
 *
 * A static server component: real links into the four real 16-A
 * investigation surfaces, each with a one-line description of the flow it
 * starts, and nothing else. No fake metric, no count, no decorative card —
 * building an aggregate number here would mean a new query this batch does
 * not need, and a static "0" would be worse than no number at all. No detail
 * screen is duplicated here; every card is a link out, never a rendering of
 * the target screen's own content.
 */

const ENTRY_POINTS: { href: string; label: string; description: string }[] = [
  {
    href: "/admin/users",
    label: "Users",
    description: "Start from a Clerk user id → see their recent generations → follow one into Generations.",
  },
  {
    href: "/admin/workspaces",
    label: "Workspace / Project",
    description: "Start from a project id → see its owner and recent generations → follow one into Generations.",
  },
  {
    href: "/admin/risk",
    label: "Risk",
    description: "Look up security_events and media-safety evidence by user, generation, or trace id.",
  },
  {
    href: "/admin/generations",
    label: "Generations",
    description: "Start from a generation id → see its attempts, trace correlation, and linked media.",
  },
  {
    href: "/admin/billing",
    label: "Billing / Credits",
    description: "Look up a user's wallet, ledger, and reservations by Clerk user id or generation id.",
  },
  {
    href: "/admin/assets",
    label: "Assets / Storage",
    description: "Look up an asset's storage and backup evidence by asset id or generation id.",
  },
];

export default function AdminInvestigationEntryPoints() {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Start an investigation</h2>
      <p className="mb-4 text-xs text-neutral-500">
        User → recent generation → Generation Investigation → attempts → trace/correlation evidence. A
        Workspace/Project follows the same generation link. Risk evidence, where it exists, references the same user
        or generation ids.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ENTRY_POINTS.map((entry) => (
          <Link
            key={entry.href}
            href={entry.href}
            className="rounded border border-neutral-800 p-3 hover:bg-neutral-900"
          >
            <div className="mb-1 text-sm font-medium text-neutral-100">{entry.label}</div>
            <div className="text-xs text-neutral-500">{entry.description}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
