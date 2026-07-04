"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, X } from "lucide-react";

/** Neon turquoise brand accent (per 1:1 spec). */
const NEON = "#00F0FF";

interface ChooseLanguageModalProps {
  open: boolean;
  onClose: () => void;
  selected: string;
  onSelect: (language: string) => void;
}

/** Exact 1:1 language set + flags from the reference grid. */
const LANGUAGES: { name: string; flag: string }[] = [
  { name: "English", flag: "🇬🇧" },
  { name: "Chinese", flag: "🇨🇳" },
  { name: "French", flag: "🇫🇷" },
  { name: "Hindi", flag: "🇮🇳" },
  { name: "Italian", flag: "🇮🇹" },
  { name: "Japanese", flag: "🇯🇵" },
  { name: "Korean", flag: "🇰🇷" },
  { name: "Portuguese", flag: "🇵🇹" },
  { name: "Russian", flag: "🇷🇺" },
  { name: "Turkish", flag: "🇹🇷" },
  { name: "Spanish", flag: "🇪🇸" },
  { name: "German", flag: "🇩🇪" },
];

export default function ChooseLanguageModal({
  open,
  onClose,
  selected,
  onSelect,
}: ChooseLanguageModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <div
            onClick={onClose}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />

          {/* Modal card */}
          <motion.div
            initial={{ scale: 0.96, y: 12, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.97, y: 8, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="relative z-10 w-full max-w-[560px] overflow-hidden rounded-[20px] border border-white/10"
            style={{
              background: "rgba(13,15,17,0.96)",
              boxShadow:
                "0 24px 80px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,240,255,0.08)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-white">
                Choose language
              </p>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Flag grid */}
            <div className="grid grid-cols-2 gap-2 p-5 sm:grid-cols-3">
              {LANGUAGES.map((lang) => {
                const active = selected === lang.name;
                return (
                  <button
                    key={lang.name}
                    type="button"
                    onClick={() => {
                      onSelect(lang.name);
                      onClose();
                    }}
                    className="group flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all duration-150"
                    style={
                      active
                        ? {
                            borderColor: NEON,
                            background: "rgba(0,240,255,0.10)",
                            boxShadow: "0 0 18px rgba(0,240,255,0.25)",
                          }
                        : {
                            borderColor: "rgba(255,255,255,0.07)",
                            background: "rgba(255,255,255,0.02)",
                          }
                    }
                    onMouseEnter={(e) => {
                      if (active) return;
                      e.currentTarget.style.borderColor = "rgba(0,240,255,0.6)";
                      e.currentTarget.style.boxShadow =
                        "0 0 18px rgba(0,240,255,0.22)";
                    }}
                    onMouseLeave={(e) => {
                      if (active) return;
                      e.currentTarget.style.borderColor =
                        "rgba(255,255,255,0.07)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <span className="text-xl leading-none">{lang.flag}</span>
                    <span
                      className="flex-1 truncate text-sm font-semibold uppercase tracking-wide transition-colors"
                      style={{ color: active ? NEON : "#e4e4e7" }}
                    >
                      {lang.name}
                    </span>
                    {active && (
                      <Check
                        className="h-4 w-4 shrink-0"
                        style={{ color: NEON }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
