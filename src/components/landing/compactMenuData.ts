import {
  BookOpen,
  Cpu,
  KeyRound,
  Layers,
  Route,
  SquareTerminal,
  Server,
  Terminal,
  Zap,
  type LucideIcon,
} from "lucide-react";

export interface CompactItem {
  label: string;
  description: string;
  icon: LucideIcon;
}

export const SUPERCOMPUTER_ITEMS: CompactItem[] = [
  { label: "GPU Cloud", description: "Dedicated render capacity", icon: Cpu },
  { label: "Batch Generation", description: "Queue large generation jobs", icon: Layers },
  { label: "Model Routing", description: "Auto-select the fastest model", icon: Route },
  { label: "Fast Queue", description: "Priority render lane", icon: Zap },
  { label: "API Access", description: "Programmatic compute access", icon: SquareTerminal },
];

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
