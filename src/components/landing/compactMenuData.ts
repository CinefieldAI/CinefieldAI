import {
  BookOpen,
  KeyRound,
  SquareTerminal,
  Server,
  Terminal,
  type LucideIcon,
} from "lucide-react";

export interface CompactItem {
  label: string;
  description: string;
  icon: LucideIcon;
}

/*
 * SUPERCOMPUTER_ITEMS was removed deliberately. The navbar's Supercomputer
 * entry no longer opens a dropdown of placeholder capabilities (GPU Cloud,
 * Batch Generation, Model Routing, Fast Queue, API Access) — it now routes
 * straight to /supercomputer, which is the real working surface. See
 * Navbar.tsx's SUPERCOMPUTER_LINK.
 */

export const MCP_CLI_ITEMS: CompactItem[] = [
  { label: "MCP Server", description: "Connect agents over MCP", icon: Server },
  { label: "CLI Tools", description: "Generate from the terminal", icon: Terminal },
  { label: "API Keys", description: "Manage your credentials", icon: KeyRound },
  { label: "Docs", description: "Integration guides & reference", icon: BookOpen },
  {
    label: "Developer Console",
    description: "Monitor usage & logs",
    icon: SquareTerminal,
  },
];
