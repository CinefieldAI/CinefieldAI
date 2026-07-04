"use client";

export default function AskDropdown({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="absolute top-full right-0 mt-2 z-50"
      style={{
        borderRadius: "20px",
        padding: "4px",
        background: "rgba(30,30,32,0.95)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        minWidth: "240px",
      }}
    >
      {[
        { id: "auto", label: "Auto-run without approval", icon: "✓" },
        { id: "approve", label: "Approve before generation", icon: "👆", selected: true },
      ].map((item) => (
        <button
          key={item.id}
          onClick={onClose}
          className="w-full flex items-center justify-between gap-5 px-2 py-2 rounded-full hover:bg-white/3 transition-all text-white"
          style={{
            fontSize: "12px",
            fontWeight: 500,
            background: item.selected ? "rgba(255,255,255,0.05)" : "transparent",
          }}
        >
          <div className="flex items-center gap-2">
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </div>
          {item.selected && <span className="text-[#85f02d]">✓</span>}
        </button>
      ))}
    </div>
  );
}
