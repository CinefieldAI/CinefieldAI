"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Play, Plus, X } from "lucide-react";

/** Neon turquoise brand accent (per 1:1 spec). */
const NEON = "#00F0FF";

interface SelectVoiceModalProps {
  open: boolean;
  onClose: () => void;
  selectedVoice: string | null;
  onSelectVoice: (name: string) => void;
  /** Optional hook for the "Create custom voice" CTA. */
  onCreateVoice?: () => void;
}

const VOICES: { name: string; tag: string }[] = [
  { name: "Aria", tag: "Expressive · Female" },
  { name: "Roger", tag: "Warm · Male" },
  { name: "Sarah", tag: "Soft · Female" },
  { name: "Laura", tag: "Bright · Female" },
  { name: "Charlie", tag: "Natural · Male" },
  { name: "George", tag: "Deep · Male" },
  { name: "Callum", tag: "Gravel · Male" },
  { name: "River", tag: "Calm · Neutral" },
  { name: "Liam", tag: "Young · Male" },
  { name: "Charlotte", tag: "Seductive · Female" },
];

/** Small static waveform preview (turquoise) for each voice row. */
const ROW_BARS = Array.from({ length: 18 }, (_, i) =>
  26 + Math.round(Math.abs(Math.sin(i * 0.9)) * 64),
);

export default function SelectVoiceModal({
  open,
  onClose,
  selectedVoice,
  onSelectVoice,
  onCreateVoice,
}: SelectVoiceModalProps) {
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
            className="relative z-10 flex max-h-[80vh] w-full max-w-[520px] flex-col overflow-hidden rounded-[20px] border border-white/10"
            style={{
              background: "rgba(13,15,17,0.96)",
              boxShadow: `0 24px 80px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,240,255,0.08)`,
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-white">
                Select or add a voice
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

            {/* Create custom voice CTA */}
            <div className="px-5 pt-4">
              <button
                type="button"
                onClick={onCreateVoice}
                className="group flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all"
                style={{
                  borderColor: "rgba(0,240,255,0.45)",
                  background:
                    "linear-gradient(100deg, rgba(0,240,255,0.14), rgba(0,240,255,0.04))",
                }}
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: NEON, color: "#04181b" }}
                >
                  <Plus className="h-5 w-5" strokeWidth={2.5} />
                </span>
                <span className="flex flex-col">
                  <span
                    className="text-sm font-bold"
                    style={{ color: NEON }}
                  >
                    Create custom voice
                  </span>
                  <span className="text-xs text-zinc-400">
                    Clone a voice or design a brand-new one
                  </span>
                </span>
              </button>
            </div>

            {/* Voice list */}
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-5 pb-5">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Library
              </p>
              <div className="space-y-1.5">
                {VOICES.map((voice) => {
                  const active = selectedVoice === voice.name;
                  return (
                    <button
                      key={voice.name}
                      type="button"
                      onClick={() => {
                        onSelectVoice(voice.name);
                        onClose();
                      }}
                      className="flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-colors"
                      style={
                        active
                          ? {
                              borderColor: "rgba(0,240,255,0.5)",
                              background: "rgba(0,240,255,0.08)",
                            }
                          : {
                              borderColor: "rgba(255,255,255,0.06)",
                              background: "rgba(255,255,255,0.02)",
                            }
                      }
                    >
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors"
                        style={{
                          background: active
                            ? "rgba(0,240,255,0.18)"
                            : "rgba(255,255,255,0.06)",
                          color: active ? NEON : "#d4d4d8",
                        }}
                      >
                        <Play className="h-3.5 w-3.5" fill="currentColor" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-white">
                          {voice.name}
                        </span>
                        <span className="block truncate text-xs text-zinc-500">
                          {voice.tag}
                        </span>
                      </span>
                      {/* Turquoise mini waveform */}
                      <span className="hidden h-5 items-end gap-[2px] sm:flex">
                        {ROW_BARS.map((h, i) => (
                          <span
                            key={i}
                            className="w-[2px] rounded-full"
                            style={{
                              height: `${h}%`,
                              background: active
                                ? NEON
                                : "rgba(255,255,255,0.2)",
                            }}
                          />
                        ))}
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
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
