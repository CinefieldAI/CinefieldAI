"use client";

import { useParams } from "next/navigation";
import Navbar from "@/components/landing/Navbar";
import { FEATURE_LABELS, slugifyFeature } from "@/components/landing/explore/exploreFeatureLabels";

// Placeholder route for every pill in the Explore page's "Explore more AI
// features" row — same treatment as /shorts-studio and /explainer: a real,
// working link and its own route rather than href="#", showing Coming soon
// until each feature gets a dedicated workspace.
export default function FeatureComingSoonPage() {
  const params = useParams<{ slug: string }>();
  const label =
    FEATURE_LABELS.find((candidate) => slugifyFeature(candidate) === params.slug) ??
    params.slug.replace(/-/g, " ");
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
          {label}
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Coming soon</h1>
        <p className="mt-2 max-w-md text-sm text-zinc-400">
          {label} tools are on the way.
        </p>
      </main>
    </div>
  );
}
