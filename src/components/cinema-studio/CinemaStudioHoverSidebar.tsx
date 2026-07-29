"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Home, Compass, Heart, LayoutGrid, Search, Plus, ArrowDownUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const topNavItems: NavItem[] = [
  {
    id: "home",
    label: "Home",
    icon: <Home className="w-4 h-4" />,
  },
  {
    id: "elements",
    label: "My elements",
    icon: <Compass className="w-4 h-4" />,
  },
  {
    id: "favorites",
    label: "My favorites",
    icon: <Heart className="w-4 h-4" />,
  },
  {
    id: "community",
    label: "Community feed",
    icon: <LayoutGrid className="w-4 h-4" />,
  },
];

export default function CinemaStudioHoverSidebar() {
  const [isExpanded, setIsExpanded] = useState(false);

  const NavItemButton = ({ item }: { item: NavItem }) => (
    <motion.button
      className={cn(
        "relative w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
        "hover:bg-white/5 text-gray-400"
      )}
      whileHover={{ backgroundColor: "rgba(255,255,255,0.08)" }}
      whileTap={{ scale: 0.95 }}
    >
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
      initial={false}
      animate={{ width: isExpanded ? "15rem" : "3.05rem" }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className={cn(
        "fixed left-2 top-[72px] z-30 h-[calc(100vh-88px)] bg-[#18191C] border border-white/[0.04] flex flex-col",
        "overflow-hidden rounded-[1.25rem]"
      )}
    >
      {/* Top Section */}
      <div className="flex-1 p-2 space-y-1 overflow-y-auto">
        {/* Header */}
        <motion.div
          initial={false}
          animate={{ opacity: isExpanded ? 1 : 0, height: isExpanded ? "auto" : 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Cinema Studio
          </div>
        </motion.div>

        {/* Navigation Items */}
        {topNavItems.map((item) => (
          <NavItemButton key={item.id} item={item} />
        ))}
      </div>

      {/* Projects Section */}
      <div className="border-t border-white/[0.06] p-2 space-y-2">
        {/* Projects Header */}
        <motion.div
          initial={false}
          animate={{ opacity: isExpanded ? 1 : 0, height: isExpanded ? "auto" : 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Projects
            </span>
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
              title="Sort projects"
            >
              <ArrowDownUp className="w-3 h-3" />
            </button>
          </div>
        </motion.div>

        {/* Search / Actions */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded-lg text-gray-400 hover:bg-white/5 hover:text-white transition-colors flex-shrink-0"
            title="Search projects"
          >
            <Search className="w-4 h-4" />
          </button>
          <motion.button
            initial={false}
            animate={{ opacity: isExpanded ? 1 : 0, width: isExpanded ? "auto" : 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden flex-1 flex items-center gap-2 px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 transition-colors text-xs font-medium"
            title="New project"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span className="whitespace-nowrap">New</span>
          </motion.button>
        </div>
      </div>
    </motion.aside>
  );
}
