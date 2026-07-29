"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronUp, Sparkles } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import ModelItem from "./ModelItem";
import { ALL_MODELS, FEATURED_MODELS } from "./createImageData";

interface ModelSelectorProps {
  selected: string;
  onSelect: (name: string) => void;
  /**
   * "large" renders the 40px GPT Image 2 style trigger; "mini" renders the
   * 28px lime-accented chip shared by every other capability-driven model
   * row (Soul Cinema, WAN 2.2, Multi Reference, ...); default is the 36px
   * compact pill used by the legacy generic control row.
   */
  size?: "compact" | "large" | "mini";
}

export default function ModelSelector({ selected, onSelect, size = "compact" }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const selectedIcon = [...FEATURED_MODELS, ...ALL_MODELS].find(
    (m) => m.name === selected,
  )?.icon;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const handleSelect = (name: string) => {
    onSelect(name);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      {size === "mini" ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-white/5 px-2 text-xs font-medium text-white/85 transition-colors hover:bg-white/10 active:bg-white/20 ${
            open ? "bg-white/10" : ""
          }`}
        >
          {selectedIcon ? (
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-[4px]"
              style={{ boxShadow: "0 0 0 1px rgba(209,254,23,0.35)" }}
            >
              <Image
                src={selectedIcon}
                alt={selected}
                width={16}
                height={16}
                className="h-full w-full object-cover"
              />
            </span>
          ) : (
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-[9px] font-bold"
              style={{ background: "rgba(209,254,23,0.15)", color: "rgb(209,254,23)" }}
            >
              {selected.charAt(0)}
            </span>
          )}
          <span className="max-w-[120px] truncate">{selected}</span>
          <ChevronUp
            className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform ${open ? "" : "rotate-180"}`}
          />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border text-[13px] font-medium transition-all duration-[160ms] ease-out hover:-translate-y-px active:scale-[0.98] active:duration-100 ${
            size === "large" ? "h-10 px-3" : "h-9 rounded-full px-3"
          } ${
            open
              ? "border-[rgba(0,229,255,0.55)] bg-[rgba(0,229,255,0.12)] text-white"
              : "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.055)] text-[rgba(255,255,255,0.78)] hover:border-[rgba(255,255,255,0.14)] hover:bg-[rgba(255,255,255,0.09)] hover:text-[rgba(255,255,255,0.95)]"
          }`}
        >
          {selectedIcon ? (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white">
              <Image
                src={selectedIcon}
                alt={selected}
                width={20}
                height={20}
                className="h-full w-full object-cover"
              />
            </span>
          ) : (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-magenta-500 to-magenta-600 text-[10px] font-semibold text-white">
              {selected.charAt(0)}
            </span>
          )}
          <span className="max-w-[150px] truncate">{selected}</span>
          <ChevronUp
            className={`h-3.5 w-3.5 shrink-0 opacity-75 transition-transform ${open ? "" : "rotate-180"}`}
          />
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            style={{
              width: "420px",
              maxWidth: "calc(100vw - 40px)",
              maxHeight: "520px",
              marginBottom: "10px",
              borderRadius: "24px",
              padding: "10px",
              background: "rgba(14,14,18,0.94)",
              backdropFilter: "blur(16px) saturate(130%)",
              WebkitBackdropFilter: "blur(16px) saturate(130%)",
              border: "1px solid rgba(255,255,255,0.10)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.65)",
              zIndex: 120,
            }}
            className="absolute bottom-full left-0 overflow-y-auto"
          >
            <p
              style={{
                fontSize: "11px",
                letterSpacing: "0.08em",
                color: "rgba(255,255,255,0.42)",
                padding: "8px 10px",
              }}
              className="flex items-center gap-1.5 uppercase"
            >
              <Sparkles className="h-3 w-3 text-magenta-400" />
              Featured Models
            </p>
            <div className="flex flex-col gap-1">
              {FEATURED_MODELS.map((model) => (
                <ModelItem
                  key={model.name}
                  model={model}
                  isSelected={selected === model.name}
                  onSelect={handleSelect}
                />
              ))}
            </div>

            <Separator className="my-2" />

            <p
              style={{
                fontSize: "11px",
                letterSpacing: "0.08em",
                color: "rgba(255,255,255,0.42)",
                padding: "8px 10px",
              }}
              className="uppercase"
            >
              All Models
            </p>
            <div className="flex flex-col gap-1">
              {ALL_MODELS.map((model) => (
                <ModelItem
                  key={`${model.name}-${model.description}`}
                  model={model}
                  isSelected={selected === model.name}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
