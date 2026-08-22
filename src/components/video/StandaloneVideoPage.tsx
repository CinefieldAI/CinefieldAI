"use client";

import { Suspense, useState } from "react";
import { Film } from "lucide-react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/landing/Navbar";
import type { ActiveView } from "@/components/landing/panelData";
import StandaloneVideoCreationPanel from "./StandaloneVideoCreationPanel";
import StandaloneVideoContentTabs, {
  type StandaloneVideoContentTab,
} from "./StandaloneVideoContentTabs";
import StandaloneVideoHowItWorks from "./StandaloneVideoHowItWorks";
import ConceptToFinalCutTutorial from "./ConceptToFinalCutTutorial";
import EditVideoPromoCarousel from "./EditVideoPromoCarousel";
import MotionLibraryView from "./MotionLibraryView";
import VideoPresetSelector from "./VideoPresetSelector";
import type { StandaloneVideoWorkflow } from "./StandaloneVideoCreationPanel";

export default function StandaloneVideoPage() {
  const router = useRouter();
  const [contentTab, setContentTab] =
    useState<StandaloneVideoContentTab>("how-it-works");
  const [workflow, setWorkflow] =
    useState<StandaloneVideoWorkflow>("create-video");
  // Motion Control's "How it works" / "Open Motion Library" button swaps
  // the right column for the 3-step tutorial (reference: no modal).
  // Pressing it again, picking a tab, or leaving the tab restores.
  const [motionTutorialOpen, setMotionTutorialOpen] = useState(false);
  // The preview card's "Change" / "Mix" buttons swap the right column for
  // the preset selector (reference: fills the right column, not a modal).
  // "mix" is the reference's for=second-motion mode.
  const [presetSelectorMode, setPresetSelectorMode] = useState<
    "change" | "mix" | null
  >(null);
  // The preset the preview card shows. "General" is the reference default;
  // a Mix selection blends a SECOND preset in (shown as "<preset> x
  // <second motion>", the reference's for=second-motion result).
  const [preset, setPreset] = useState("General");
  const [secondMotion, setSecondMotion] = useState<string | null>(null);
  const presetName = secondMotion ? `${preset} x ${secondMotion}` : preset;

  const handleWorkflowChange = (next: StandaloneVideoWorkflow) => {
    setWorkflow(next);
    setMotionTutorialOpen(false);
    // Switching tab by hand leaves the selector; the Edit tab's Change
    // re-opens it right after this call (its open call wins the batch).
    setPresetSelectorMode(null);
  };

  const handleContentTabChange = (tab: StandaloneVideoContentTab) => {
    setContentTab(tab);
    setMotionTutorialOpen(false);
    setPresetSelectorMode(null);
  };

  const handleOpenPresetSelector = (mode: "change" | "mix") => {
    setPresetSelectorMode(mode);
    setMotionTutorialOpen(false);
  };

  const navigateForView = (view: ActiveView) => {
    const routes: Partial<Record<ActiveView, string>> = {
      default: "/",
      canvas: "/canvas",
      createImage: "/generate",
      createVideo: "/video/create",
      createAudio: "/audio/create",
    };
    router.push(routes[view] ?? "/");
  };

  return (
    <div className="min-h-screen bg-[#0b0c0d] text-white">
      <Navbar
        activePanel={null}
        onOpenImagePanel={() => router.push("/generate")}
        onOpenVideoPanel={() => router.push("/video/create")}
        onOpenAudioPanel={() => router.push("/audio/create")}
        onSetView={navigateForView}
      />

      <div className="flex min-h-[calc(100dvh-4rem)] flex-col gap-3 p-3 lg:h-[calc(100dvh-4rem)] lg:min-h-0 lg:flex-row">
        <Suspense
          fallback={
            <div className="w-full shrink-0 rounded-2xl border border-white/[0.07] bg-[#17191b] lg:h-full lg:w-80" />
          }
        >
          <StandaloneVideoCreationPanel
            workflow={workflow}
            onWorkflowChange={handleWorkflowChange}
            onOpenPresetSelector={handleOpenPresetSelector}
            presetName={presetName}
            onToggleMotionTutorial={() =>
              setMotionTutorialOpen((open) => !open)
            }
          />
        </Suspense>

        <main
          id="create-page-content"
          className="relative flex size-full min-h-0 min-w-0 flex-1 flex-col gap-2.5 pb-3"
        >
          {presetSelectorMode ? (
            /* The preset selector fills the right column; the left panel
               stays put (reference: /ai/video?select=preset — no modal). */
            <VideoPresetSelector
              mode={presetSelectorMode}
              onClose={() => setPresetSelectorMode(null)}
              onSelectPreset={(name) => {
                if (presetSelectorMode === "mix") {
                  setSecondMotion(name);
                  return;
                }
                // A fresh preset drops the previously mixed second motion.
                setPreset(name);
                setSecondMotion(null);
              }}
            />
          ) : (
            <>
            <StandaloneVideoContentTabs
              value={contentTab}
              onChange={handleContentTabChange}
              secondaryLabel={
                workflow === "motion-control"
                  ? "Motion library"
                  : "How it works"
              }
            />

            <div className="min-h-0 flex-1 overflow-y-auto">
              {workflow === "motion-control" && motionTutorialOpen ? (
                /* The preview card's "How it works" button replaces the
                   right column with the tutorial (reference: not a modal). */
                <ConceptToFinalCutTutorial />
              ) : contentTab === "how-it-works" ? (
                <div
                  id="standalone-video-panel-how-it-works"
                  role="tabpanel"
                  aria-labelledby="standalone-video-tab-how-it-works"
                >
                  {workflow === "create-video" ? (
                    <StandaloneVideoHowItWorks />
                  ) : workflow === "edit-video" ? (
                    /* Edit Video's How it works view is a promo carousel;
                       the 3-step tutorial belongs to Motion Control. */
                    <EditVideoPromoCarousel />
                  ) : (
                    /* Motion library tab, tutorial closed. */
                    <MotionLibraryView />
                  )}
                </div>
              ) : (
                <section
                  id="standalone-video-panel-history"
                  role="tabpanel"
                  aria-labelledby="standalone-video-tab-history"
                  className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-white/[0.07] bg-[#181a1c] px-6 text-center"
                >
                  <span className="flex size-12 items-center justify-center rounded-xl bg-white/[0.05] text-zinc-500">
                    <Film className="size-5" />
                  </span>
                  <h1 className="mt-4 text-base font-semibold text-white">
                    No videos yet
                  </h1>
                  <p className="mt-1 max-w-sm text-sm leading-5 text-zinc-500">
                    Generated and edited videos will appear here without changing
                    your current creation settings.
                  </p>
                </section>
              )}
            </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
