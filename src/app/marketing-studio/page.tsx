"use client";

import Navbar from "@/components/landing/Navbar";
import Sidebar from "@/components/cinema-studio/Sidebar";

export default function MarketingStudio() {
  const noop = () => {};

  return (
    <div className="min-h-screen w-full bg-[#0a0a0c]">
      <Navbar
        activePanel={null}
        onOpenImagePanel={noop}
        onOpenVideoPanel={noop}
        onOpenAudioPanel={noop}
        onSetView={noop}
      />

      <div className="flex">
        <Sidebar collapsed={false} onToggle={noop} />
        <main className="flex-1 p-8">
          <h1 className="text-4xl font-bold text-white mb-4">Marketing Studio</h1>
          <p className="text-white/50">Coming soon...</p>
        </main>
      </div>
    </div>
  );
}
