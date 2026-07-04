"use client";

import { Fragment } from "react";
import { Separator } from "@/components/ui/separator";
import type { CompactItem } from "./compactMenuData";

interface CompactDropdownProps {
  items: CompactItem[];
  onSelect?: (label: string) => void;
}

export default function CompactDropdown({ items, onSelect }: CompactDropdownProps) {
  return (
    <div className="w-[300px] overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0B0B0C] p-2 shadow-2xl shadow-black/60">
      <div className="flex flex-col">
        {items.map((item, idx) => {
          const Icon = item.icon;
          return (
            <Fragment key={item.label}>
              <button
                type="button"
                onClick={() => onSelect?.(item.label)}
                className="group flex w-full items-start gap-3 rounded-lg border border-transparent px-2.5 py-2.5 text-left transition-colors hover:border-[#00e5ff]/20 hover:bg-white/[0.04]"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-zinc-400 transition-colors group-hover:bg-magenta-500/10 group-hover:text-magenta-400">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-white">
                    {item.label}
                  </span>
                  <span className="block truncate text-xs text-zinc-500">
                    {item.description}
                  </span>
                </span>
              </button>
              {idx < items.length - 1 && <Separator className="my-0.5" />}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
