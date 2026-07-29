"use client";

import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { MoreHorizontal, Plus, X } from "lucide-react";

export interface ColorTransferSwatch {
  id: string;
  hex: string;
  name: string;
}

interface ColorTransferPanelProps {
  isOpen: boolean;
  onClose: () => void;
  swatches: ColorTransferSwatch[];
  onAddSwatch: (swatch: ColorTransferSwatch) => void;
  onRemoveSwatch: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * Shared Higgsfield-style "Soul HEX" Color Transfer panel — reused as-is by
 * every model that supports Color Transfer (Recraft V4.1, Recraft V4.1
 * Utility, ...). One implementation, connected per model via capabilities;
 * never forked per model.
 */
export default function ColorTransferPanel({
  isOpen,
  onClose,
  swatches,
  onAddSwatch,
  onRemoveSwatch,
  selectedId,
  onSelect,
}: ColorTransferPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      let hex = "#D1FE17";
      if (ctx) {
        ctx.drawImage(img, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
      }
      const id = `swatch-${Date.now()}`;
      onAddSwatch({ id, hex, name: file.name.replace(/\.[^.]+$/, "") });
      onSelect(id);
    };
    img.src = url;
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[999998] bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          aria-label="Color transfer"
          className="fixed left-1/2 top-1/2 z-[999999] -translate-x-1/2 -translate-y-1/2 focus:outline-none"
        >
          <div
            className="relative flex max-h-[80vh] w-[min(420px,calc(100vw-32px))] flex-col gap-1 overflow-hidden rounded-[24px] border border-[rgba(255,255,255,0.05)] bg-[rgba(35,38,42,0.75)] p-2 shadow-[0_12px_20px_rgba(0,0,0,0.24)] backdrop-blur-[40px]"
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between px-2 py-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-white/50">
                Generation settings
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close color transfer"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-white transition-colors hover:bg-white/10"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              <h3 className="text-lg font-bold text-white">Soul HEX</h3>
              <p className="mt-1 text-sm text-white/60">
                Upload a reference image and let Soul HEX bring its colors into your own style.
              </p>

              {/* Banner area */}
              <div
                className="mt-4 aspect-video overflow-hidden rounded-xl border border-white/10"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(209,254,23,0.18), rgba(20,20,22,0.9) 60%)",
                }}
              />

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFile}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
                style={{ background: "rgb(209,254,23)" }}
              >
                <Plus className="size-4" />
                Upload &amp; Create
              </button>

              {/* Color / preview cards */}
              {swatches.length === 0 ? (
                <div className="mt-6 text-center text-xs text-white/40">
                  Ready to Create Your Hex?
                  <br />
                  Saved hex cards will appear here. No hex yet — upload an image to begin.
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {swatches.map((s) => {
                    const selected = s.id === selectedId;
                    return (
                      <div
                        key={s.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelect(selected ? null : s.id)}
                        className={`group relative cursor-pointer rounded-xl border p-2 transition-colors ${
                          selected ? "border-[rgb(209,254,23)] bg-white/10" : "border-white/10 hover:bg-white/5"
                        }`}
                      >
                        <div className="h-12 w-full rounded-lg" style={{ background: s.hex }} />
                        <p className="mt-1.5 truncate text-[11px] text-white/70">{s.name}</p>
                        <p className="truncate text-[10px] text-white/40">{s.hex}</p>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId((v) => (v === s.id ? null : s.id));
                          }}
                          aria-label="Card options"
                          className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/40 text-white/70 opacity-0 transition-opacity hover:bg-black/60 group-hover:opacity-100"
                        >
                          <MoreHorizontal className="size-3" />
                        </button>
                        {menuOpenId === s.id && (
                          <div className="absolute right-1 top-7 z-10 w-24 rounded-lg border border-white/10 bg-[#131517] p-1 text-xs shadow-lg">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRemoveSwatch(s.id);
                                if (selected) onSelect(null);
                                setMenuOpenId(null);
                              }}
                              className="w-full rounded px-2 py-1 text-left text-red-400 transition-colors hover:bg-white/5"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
