"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Home, Grid3x3, Heart, Link2, Paperclip, FolderOpen, Settings, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  href?: string;
  onClick?: () => void;
  divider?: boolean;
}

interface MarketingStudioSidebarProps {
  activeSidebarView: "home" | "allGenerations" | "favorites";
  onViewChange: (view: "home" | "allGenerations" | "favorites") => void;
}

export default function MarketingStudioSidebar({
  activeSidebarView,
  onViewChange,
}: MarketingStudioSidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const pathname = usePathname();

  const topNavItems: NavItem[] = [
    {
      id: "home",
      label: "Home",
      icon: <Home className="w-4 h-4" />,
      onClick: () => onViewChange("home"),
    },
    {
      id: "all-generations",
      label: "All generations",
      icon: <Grid3x3 className="w-4 h-4" />,
      onClick: () => onViewChange("allGenerations"),
    },
    {
      id: "favorites",
      label: "My favorites",
      icon: <Heart className="w-4 h-4" />,
      onClick: () => onViewChange("favorites"),
    },
    {
      id: "url-to-ad",
      label: "Url to Ad",
      icon: <Link2 className="w-4 h-4" />,
    },
    {
      id: "ad-reference",
      label: "Ad Reference",
      icon: <Paperclip className="w-4 h-4" />,
    },
    {
      id: "projects",
      label: "Projects",
      icon: <FolderOpen className="w-4 h-4" />,
    },
  ];

  const bottomNavItems: NavItem[] = [
    {
      id: "settings",
      label: "Settings",
      icon: <Settings className="w-4 h-4" />,
    },
  ];

  const isActive = (id: string): boolean => {
    if (id === "home" && activeSidebarView === "home") return true;
    if (id === "all-generations" && activeSidebarView === "allGenerations") return true;
    if (id === "favorites" && activeSidebarView === "favorites") return true;
    return false;
  };

  const NavItemButton = ({ item, isBottom = false }: { item: NavItem; isBottom?: boolean }) => (
    <motion.button
      onClick={item.onClick}
      className={cn(
        "relative w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
        "hover:bg-white/5",
        isActive(item.id) ? "bg-white/10 text-white" : "text-gray-400"
      )}
      whileHover={{ backgroundColor: "rgba(255,255,255,0.08)" }}
      whileTap={{ scale: 0.95 }}
    >
      {isActive(item.id) && (
        <motion.div
          layoutId="activeIndicator"
          className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500 rounded-r"
          transition={{ duration: 0.2 }}
        />
      )}
      <div className="flex-shrink-0">{item.icon}</div>
      <motion.span
        initial={false}
        animate={{ opacity: isExpanded ? 1 : 0, width: isExpanded ? "auto" : 0 }}
        transition={{ duration: 0.2 }}
        className="overflow-hidden whitespace-nowrap text-sm font-medium"
      >
        {item.label}
      </motion.span>
    </motion.button>
  );

  return (
    <motion.aside
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
      animate={{ width: isExpanded ? "15rem" : "3.05rem" }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className={cn(
        "fixed left-0 top-[72px] z-40 h-[calc(100vh-72px)] bg-black/50 border-r border-white/10 flex flex-col",
        "overflow-hidden"
      )}
    >
      {/* Top Section */}
      <div className="flex-1 p-2 space-y-1 overflow-y-auto">
        {/* Marketing Studio Header */}
        <motion.div
          initial={false}
          animate={{ opacity: isExpanded ? 1 : 0, height: isExpanded ? "auto" : 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Marketing Studio
          </div>
        </motion.div>

        {/* Navigation Items */}
        {topNavItems.map((item) => (
          <NavItemButton key={item.id} item={item} />
        ))}
      </div>

      {/* Bottom Section */}
      <div className="border-t border-white/10 p-2 space-y-1">
        {bottomNavItems.map((item) => (
          <NavItemButton key={item.id} item={item} isBottom />
        ))}
      </div>
    </motion.aside>
  );
}
