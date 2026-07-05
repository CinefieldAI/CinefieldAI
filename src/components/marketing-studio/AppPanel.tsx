"use client";

import { X } from "lucide-react";

interface AppPanelProps {
  isOpen: boolean;
  onClose: () => void;
  hasApp: boolean;
  onCreateManually: () => void;
  promptBarDock?: "top" | "bottom";
}

export default function AppPanel({
  isOpen,
  onClose,
  hasApp,
  onCreateManually,
  promptBarDock = "bottom",
}: AppPanelProps) {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[998] bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed z-[999] left-1/2 -translate-x-1/2 w-[min(560px,calc(100vw-32px))] rounded-2xl border border-white/10 bg-[#0f1b15] text-white shadow-xl overflow-hidden flex flex-col transition-all duration-300 ${
          promptBarDock === "bottom"
            ? "bottom-[160px]"
            : "top-[160px]"
        }`}
        role="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h2 className="text-lg font-semibold">Add Your App</h2>
          <button
            onClick={onClose}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* CONTENT */}
        <div className="flex-1 px-6 py-8 flex flex-col items-center justify-center space-y-6">
          {!hasApp ? (
            <>
              {/* Ghost Cards */}
              <div className="relative w-48 h-32 mb-2">
                {/* Desktop card (larger, left) */}
                <div
                  className="absolute w-24 h-32 rounded-lg bg-white/8 border border-white/10 flex items-center justify-center text-xs text-white/50"
                  style={{
                    left: "0",
                    top: "0",
                    transform: "rotate(-2.27deg)",
                  }}
                >
                  Desktop
                </div>

                {/* Mobile card (narrower, right) */}
                <div
                  className="absolute w-16 h-32 rounded-lg bg-white/8 border border-white/10 flex items-center justify-center text-xs text-white/50"
                  style={{
                    right: "0",
                    top: "8px",
                    transform: "rotate(5.08deg)",
                  }}
                >
                  Mobile
                </div>
              </div>

              {/* Text */}
              <div className="text-center">
                <p className="text-sm font-semibold mb-1">No app yet</p>
                <p className="text-xs text-white/60">
                  Add a desktop or mobile screenshot to get started
                </p>
              </div>

              {/* Create manually button */}
              <button
                onClick={onCreateManually}
                className="px-4 py-2 rounded-lg bg-white text-black text-xs font-semibold hover:bg-white/90 transition-colors mt-4"
              >
                Create manually
              </button>
            </>
          ) : (
            <div className="text-center">
              <p className="text-sm font-semibold mb-1">App Created</p>
              <p className="text-xs text-white/60">Your app has been set up</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
