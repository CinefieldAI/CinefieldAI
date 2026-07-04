"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface AddYourAppPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onProductClick: () => void;
  onAppClick: () => void;
  selectedTarget: "product" | "app";
}

export default function AddYourAppPanel({
  isOpen,
  onClose,
  onProductClick,
  onAppClick,
  selectedTarget,
}: AddYourAppPanelProps) {
  const [appUrl, setAppUrl] = useState("");

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
        className="fixed z-[999] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(960px,calc(100vw-32px))] max-h-[calc(100vh-16px)] rounded-[28px] border border-white/5 bg-[#0f1b15] text-white shadow-xl overflow-hidden flex flex-col"
        role="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* TOP PRODUCT/APP TOGGLE */}
        <div className="shrink-0 flex items-center justify-center pt-6">
          <div className="flex gap-2 bg-white/5 rounded-full p-1">
            <button
              onClick={onProductClick}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-colors ${
                selectedTarget === "product"
                  ? "bg-white/20 text-white"
                  : "text-white/60 hover:text-white"
              }`}
            >
              Product
            </button>
            <button
              onClick={onAppClick}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-colors ${
                selectedTarget === "app"
                  ? "bg-white/20 text-white"
                  : "text-white/60 hover:text-white"
              }`}
            >
              App
            </button>
          </div>
        </div>

        {/* CLOSE BUTTON */}
        <button
          onClick={onClose}
          className="absolute top-6 right-6 flex size-8 cursor-pointer items-center justify-center rounded-lg bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white z-10"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {/* CONTENT */}
        <div className="flex-1 min-h-0 overflow-y-auto px-12 py-12 flex flex-col">
          <div className="flex gap-12 flex-1">
            {/* LEFT: TEXT */}
            <div className="flex-1 flex flex-col justify-start">
              <h2 className="text-5xl font-bold uppercase tracking-tight text-white mb-6">
                ADD YOUR<br />APP
              </h2>
              <p className="text-sm text-white/60 leading-relaxed">
                Turn your app link into a creative brief that captures interface, voice, flows, and product story.
              </p>
            </div>

            {/* RIGHT: INPUT + BUTTON */}
            <div className="flex flex-col justify-start gap-6">
              {/* App URL Input */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="www.yourapp.com"
                  value={appUrl}
                  onChange={(e) => setAppUrl(e.target.value)}
                  className="px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-white/50 focus:outline-none focus:border-white/20 text-sm w-full min-w-80"
                />
              </div>

              {/* Separator */}
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-xs text-white/50">or</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              {/* Create Manually Button */}
              <button className="px-6 py-3 rounded-lg bg-white text-black font-semibold text-sm hover:bg-white/90 transition-colors w-full">
                Create manually
              </button>
            </div>
          </div>

          {/* LOWER SECTION - NO APP STATE */}
          <div className="mt-12 pt-12 border-t border-white/10">
            <div className="flex flex-col items-center justify-center py-12">
              <p className="text-xl font-semibold text-white mb-2">No app yet</p>
              <p className="text-sm text-white/50 mb-8">
                Add a desktop or mobile screenshot to get started
              </p>

              {/* Desktop/Mobile Preview Cards */}
              <div className="relative w-80 h-48">
                {/* Desktop Card */}
                <div
                  className="absolute rounded-2xl border border-white/10 bg-white/5 flex items-center justify-center"
                  style={{
                    width: "200px",
                    height: "160px",
                    left: "0",
                    top: "20px",
                    zIndex: "2",
                    transform: "rotate(-3deg)",
                  }}
                >
                  <div className="text-center">
                    <div className="text-3xl text-white/30 mb-2">▭</div>
                    <p className="text-xs text-white/40">Desktop</p>
                  </div>
                </div>

                {/* Mobile Card */}
                <div
                  className="absolute rounded-2xl border border-white/10 bg-white/5 flex items-center justify-center"
                  style={{
                    width: "120px",
                    height: "160px",
                    right: "0",
                    top: "0",
                    zIndex: "1",
                    transform: "rotate(3deg)",
                  }}
                >
                  <div className="text-center">
                    <div className="text-2xl text-white/30 mb-2">|</div>
                    <p className="text-xs text-white/40">Mobile</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
