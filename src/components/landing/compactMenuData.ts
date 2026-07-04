import {
  BookOpen,
  Cpu,
  FolderKanban,
  History,
  Image as ImageIconLucide,
  KeyRound,
  Layers,
  MessageSquare,
  Plug,
  Route,
  SquareTerminal,
  Server,
  ShieldCheck,
  Terminal,
  Users,
  Film,
  PenTool,
  Sparkles,
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

export const COLLAB_ITEMS: CompactItem[] = [
  { label: "Team Workspace", description: "Shared workspace for your team", icon: Users },
  {
    label: "Shared Projects",
    description: "Collaborate on live projects",
    icon: FolderKanban,
  },
  { label: "Comments", description: "Leave feedback on any asset", icon: MessageSquare },
  { label: "Version History", description: "Track every revision", icon: History },
  { label: "Permissions", description: "Control who can edit", icon: ShieldCheck },
];

export const PLUGINS_ITEMS: CompactItem[] = [
  { label: "Figma Plugin", description: "Generate directly inside Figma", icon: PenTool },
  {
    label: "Photoshop Plugin",
    description: "Bring AI assets into Photoshop",
    icon: ImageIconLucide,
  },
  { label: "Premiere Plugin", description: "Edit with AI inside Premiere", icon: Film },
  {
    label: "After Effects Plugin",
    description: "Motion graphics inside AE",
    icon: Sparkles,
  },
  { label: "API Integrations", description: "Connect your own stack", icon: Plug },
];
