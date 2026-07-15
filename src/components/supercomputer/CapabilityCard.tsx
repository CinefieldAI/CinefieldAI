"use client";

import { useState } from "react";
import { Lock, ChevronDown } from "lucide-react";

interface CapabilityCardProps {
  id: string;
  title: string;
  description: string;
  icon: string;
}

export default function CapabilityCard({
  title,
  description,
  icon,
}: CapabilityCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      {/* Card */}
      <button
        onClick={() => setExpanded(true)}
        className="relative overflow-hidden rounded-2xl border border-white/10 hover:border-white/20 bg-[rgba(255,255,255,0.03)] p-4 text-left transition-all hover:shadow-lg group"
        style={{
          background: "rgba(255,255,255,0.03)",
          backdropFilter: "blur(10px)",
        }}
      >
        {/* Image placeholder */}
        <div className="w-full h-32 rounded-lg mb-3 bg-gradient-to-br from-[#85f02d]/20 to-[#60e248]/10 flex items-center justify-center text-4xl relative">
          {icon}
          {/* LOCKED badge */}
          <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/60 border border-white/20 backdrop-blur-sm">
            <Lock className="w-3 h-3 text-white/70" />
            <span className="text-[10px] font-bold text-white/70 uppercase">Locked</span>
          </div>
        </div>

        {/* Content */}
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-white group-hover:text-[#85f02d] transition-colors">{title}</h3>
          <p className="text-xs text-white/50 line-clamp-2">{description}</p>
        </div>

        {/* Chevron */}
        <ChevronDown className="absolute top-4 left-4 w-5 h-5 text-white/30 group-hover:text-white/50 transition-colors" style={{ transform: "rotate(90deg)" }} />
      </button>

      {/* Expanded Panel */}
      {expanded && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setExpanded(false)}
            style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
          />

          {/* Panel - Frosted Glass */}
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => setExpanded(false)}
          >
            <div
              className="relative rounded-3xl max-w-2xl w-full max-h-[80vh] overflow-auto p-8"
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "rgba(20,20,23,0.8)",
                backdropFilter: "blur(40px)",
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              }}
            >
              {/* Close */}
              <button
                onClick={() => setExpanded(false)}
                className="absolute top-4 right-4 w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors"
              >
                ✕
              </button>

              {/* Content */}
              <div className="space-y-6">
                {/* Header Section */}
                <div className="space-y-3">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#85f02d]/30 to-[#60e248]/10 flex items-center justify-center text-5xl">
                    {icon}
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">{title}</h2>
                    <p className="text-sm text-white/70 mt-1">{description}</p>
                  </div>
                </div>

                {/* Divider */}
                <div className="h-px bg-white/5" />

                {/* Features Section */}
                <div className="space-y-2">
                  <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider">Features</h3>
                  <ul className="space-y-1">
                    {["High quality output", "Fast processing", "Customizable options", "Export formats"].map((f) => (
                      <li key={f} className="text-sm text-white/70 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#85f02d]" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Generate Button */}
                <button className="w-full px-6 py-3 rounded-xl bg-[#85f02d] hover:bg-[#99ff33] text-[#0a0a0a] font-bold transition-colors">
                  Generate
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
