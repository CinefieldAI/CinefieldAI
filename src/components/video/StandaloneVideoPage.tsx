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
import type { StandaloneVideoWorkflow } from "./StandaloneVideoCreationPanel";

export default function StandaloneVideoPage() {
  const router = useRouter();
  const [contentTab, setContentTab] =
    useState<StandaloneVideoContentTab>("how-it-works");
  const [workflow, setWorkflow] =
    useState<StandaloneVideoWorkflow>("create-video");

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
            <div className="w-full shrink-0 rounded-2xl border border-white/[0.07] bg-[#17191b] lg:h-full lg:w-[350px]" />
          }
        >
          <StandaloneVideoCreationPanel
            workflow={workflow}
            onWorkflowChange={setWorkflow}
          />
        </Suspense>

        <main
          id="create-page-content"
          className="relative flex size-full min-h-0 flex-1 flex-col gap-2.5 pb-3"
        >
          <StandaloneVideoContentTabs
            value={contentTab}
            onChange={setContentTab}
            secondaryLabel={
              workflow === "motion-control"
                ? "Motion library"
                : "How it works"
            }
          />

          <div className="min-h-0 flex-1 overflow-y-auto">
            {contentTab === "how-it-works" ? (
              <div
                id="standalone-video-panel-how-it-works"
                role="tabpanel"
                aria-labelledby="standalone-video-tab-how-it-works"
              >
                {workflow === "create-video" ? (
                  <StandaloneVideoHowItWorks />
                ) : (
                  <ConceptToFinalCutTutorial />
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
        </main>
      </div>
    </div>
  );
}
