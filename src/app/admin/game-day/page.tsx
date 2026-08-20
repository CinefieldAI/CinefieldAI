import GameDayAdminPanel from "@/components/admin/GameDayAdminPanel";

/**
 * /admin/game-day — Phase 26-D Chaos/Resilience Game-Day dashboard.
 *
 * Read-only, mirroring /admin/secrets's own shape. Authorization already
 * happened in src/app/admin/layout.tsx.
 */
export default function AdminGameDayPage() {
  return <GameDayAdminPanel />;
}
