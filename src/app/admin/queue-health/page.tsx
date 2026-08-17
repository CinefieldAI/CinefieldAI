import QueueHealthPanel from "@/components/admin/QueueHealthPanel";

/**
 * /admin/queue-health — Phase 16-B Queue Health (SQS + BullMQ, read + BullMQ retry).
 *
 * Authorization already happened in `src/app/admin/layout.tsx`; this page
 * renders only for an already-verified admin.
 */
export default function AdminQueueHealthPage() {
  return <QueueHealthPanel />;
}
