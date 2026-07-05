"use client";

import { useState } from "react";
import { X, Link2 } from "lucide-react";

interface ProductPanelProps {
  isOpen: boolean;
  onClose: () => void;
  productUrl: string;
  onProductUrlChange: (url: string) => void;
  onCreateManually: () => void;
  panelPlacement?: "top" | "bottom";
}

export default function ProductPanel({
  isOpen,
  onClose,
  productUrl,
  onProductUrlChange,
  onCreateManually,
  panelPlacement = "bottom",
}: ProductPanelProps) {
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
        className={`fixed z-[999] left-1/2 -translate-x-1/2 w-[min(560px,calc(100vw-32px))] rounded-2xl border border-white/10 bg-[#0f1b15] text-white shadow-xl overflow-hidden flex flex-col ${
          panelPlacement === "bottom"
            ? "bottom-[140px] translate-y-0"
            : "top-[140px] translate-y-0"
        }`}
        role="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h2 className="text-lg font-semibold">Add Your Product</h2>
          <button
            onClick={onClose}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* CONTENT */}
        <div className="flex-1 px-6 py-8 space-y-6">
          {/* TITLE */}
          <div>
            <h3 className="text-xl font-bold mb-2">ADD YOUR PRODUCT</h3>
            <p className="text-sm text-white/60">
              Add a link or upload images to use your product across generations.
            </p>
          </div>

          {/* INPUT + BUTTON ROW */}
          <div className="flex gap-3 items-center">
            {/* URL Input */}
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 h-10">
              <Link2 className="h-4 w-4 text-white/50 flex-shrink-0" />
              <input
                type="text"
                value={productUrl}
                onChange={(e) => onProductUrlChange(e.target.value)}
                placeholder="www.yourproduct.com"
                className="flex-1 bg-transparent text-sm text-white placeholder:text-white/50 outline-none"
              />
            </div>

            {/* OR Text */}
            <span className="text-xs text-white/50 font-medium">or</span>

            {/* Create Manually Button */}
            <button
              onClick={onCreateManually}
              className="px-4 py-2 rounded-lg bg-white text-black text-xs font-semibold hover:bg-white/90 transition-colors"
            >
              Create manually
            </button>
          </div>

          {/* EMPTY STATE */}
          {!productUrl && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              {/* Ghost Cards */}
              <div className="relative w-48 h-32 mb-4">
                {/* Left card */}
                <div
                  className="absolute w-20 h-24 rounded-lg bg-white/5 border border-white/10"
                  style={{
                    left: "0",
                    top: "4px",
                    transform: "rotate(-5.78deg)",
                  }}
                />
                {/* Center card */}
                <div
                  className="absolute w-24 h-28 rounded-lg bg-white/8 border border-white/15"
                  style={{
                    left: "32px",
                    top: "0",
                  }}
                />
                {/* Right card */}
                <div
                  className="absolute w-20 h-24 rounded-lg bg-white/5 border border-white/10"
                  style={{
                    right: "0",
                    top: "6px",
                    transform: "rotate(4.68deg)",
                  }}
                />
              </div>

              {/* Text */}
              <div className="text-center">
                <p className="text-sm font-semibold mb-1">No product added yet</p>
                <p className="text-xs text-white/60">
                  Paste a link or upload images to get started
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
