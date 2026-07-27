"use client";

import Navbar from "@/components/landing/Navbar";

// Placeholder route — Explainer has no dedicated workspace yet. Kept
// isolated (own route, no shared view state) so the navbar entry is a real,
// working link rather than href="#". Wire up the actual workspace here when
// it's built.
export default function ExplainerPage() {
  const noop = () => {};

  return (
    <div className="min-h-screen w-full bg-black text-white">
      <Navbar
        activePanel={null}
        onOpenImagePanel={noop}
        onOpenVideoPanel={noop}
        onOpenAudioPanel={noop}
        onSetView={noop}
      />
      <main className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-6 text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Explainer
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Coming soon</h1>
        <p className="mt-2 max-w-md text-sm text-zinc-400">
          Explainer-video creation tools are on the way.
        </p>
      </main>
    </div>
  );
}
