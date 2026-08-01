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
              width: "400px",
              maxWidth: "calc(100vw - 32px)",
              height: "100vh",
              maxHeight: "min(40rem, calc(100vh - 32px))",
              marginBottom: "10px",
              borderRadius: "16px",
              background: "rgba(28, 30, 32, 0.95)",
              backdropFilter: "blur(32px)",
              WebkitBackdropFilter: "blur(32px)",
              border: "1px solid rgba(217, 217, 217, 0.04)",
              boxShadow: "none",
              zIndex: 100000,
            }}
            className="absolute bottom-full left-0 flex flex-col overflow-hidden"
          >
            {/* Top glow */}
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 left-0 w-full h-[37px] z-0"
              style={{
                borderRadius: "317px",
                background: "rgba(139, 213, 244, 0.24)",
                filter: "blur(50px)",
              }}
            />
            {/* Lower glow */}
            <div
              aria-hidden
              className="pointer-events-none absolute left-0 w-full h-[37px] z-0"
              style={{
                bottom: "35%",
                borderRadius: "317px",
                background: "rgba(139, 213, 244, 0.24)",
                filter: "blur(50px)",
              }}
            />

            {/* Content wrapper */}
            <div className="relative z-10 flex flex-col min-h-0 flex-1">
              {/* Featured Models heading */}
              <div className="px-3 py-2 min-h-[41px] flex items-center border-b border-b-[rgba(217,217,217,0.04)]">
                <p
                  style={{
                    fontSize: "12px",
                    fontWeight: 500,
                    color: "rgba(255,255,255,0.6)",
                  }}
                  className="flex items-center gap-1.5"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Featured Models
                </p>
              </div>

              {/* Featured models list */}
              <div className="flex flex-col gap-0 min-h-0 overflow-y-auto hide-scrollbar">
                {FEATURED_MODELS.map((model) => (
                  <ModelItem
                    key={model.name}
                    model={model}
                    isSelected={selected === model.name}
                    onSelect={handleSelect}
                  />
                ))}
              </div>

              {/* All Models heading */}
              <div className="px-3 py-2 min-h-[41px] flex items-center border-t border-b border-b-[rgba(217,217,217,0.04)] border-t-[rgba(217,217,217,0.04)]">
                <p
                  style={{
                    fontSize: "12px",
                    fontWeight: 500,
                    color: "rgba(255,255,255,0.6)",
                  }}
                >
                  All Models
                </p>
              </div>

              {/* All models list */}
              <div className="flex flex-col gap-0 min-h-0 overflow-y-auto hide-scrollbar flex-1">
                {ALL_MODELS.map((model) => (
                  <ModelItem
                    key={`${model.name}-${model.description}`}
                    model={model}
                    isSelected={selected === model.name}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
