"use client";

import { useEffect, useState } from "react";
import Navbar from "@/components/landing/Navbar";
import SidePanel from "@/components/landing/SidePanel";
import CreateAudioWorkspace from "@/components/landing/createAudio/CreateAudioWorkspace";
import CreateImageWorkspace from "@/components/landing/createImage/CreateImageWorkspace";
import type { ActiveView, PanelKey } from "@/components/landing/panelData";
import type { AudioMode } from "@/components/landing/audioMenuData";

interface AppShellProps {
  initialView?: ActiveView;
  initialPanel?: PanelKey | null;
}

export default function AppShell({ initialView = "default", initialPanel = null }: AppShellProps) {
  const [activePanel, setActivePanel] = useState<PanelKey | null>(initialPanel);
  const [activeView, setActiveView] = useState<ActiveView>(initialView);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const delay = `-${((Date.now() % 20000) / 1000).toFixed(2)}s`;
      document.documentElement.style.setProperty("--global-pulse-delay", delay);
    }
  }, []);

  // Shared Audio mode/model — single source of truth for both the top-nav
  // Audio mega-dropdown (Navbar) and the bottom rotary selector + prompt bar
  // (CreateAudioWorkspace). Lives here since Navbar and the workspace are
  // siblings that both need to read and write it.
  const [audioMode, setAudioMode] = useState<AudioMode>("voiceover");
  const [audioModelIndex, setAudioModelIndex] = useState(0);

  // Model clicked in the navbar's Image mega-dropdown — routes straight into
  // the full Create Image workspace with that model preselected, instead of
  // always opening the same generic side panel regardless of which model
  // was clicked.
  const [selectedImageModel, setSelectedImageModel] = useState<string | undefined>(undefined);

  const openImagePanel = () => {
    setActivePanel("image");
  };

  const openImageModel = (modelName: string) => {
    setSelectedImageModel(modelName);
    setActiveView("createImage");
    setActivePanel(null);
  };

  const openVideoPanel = () => {
    // Video has its own dedicated full-page workspace (not the sliding panel)
    setActiveView("createVideo");
    setActivePanel(null);
  };

  const openAudioPanel = () => {
    // Audio has its own dedicated full-page workspace (not the sliding panel)
    setActiveView("createAudio");
    setActivePanel(null);
  };

  const setView = (view: ActiveView) => {
    setActiveView(view);
    setActivePanel(null);
  };

  return (
    <div className="min-h-screen w-full bg-black text-white">
      <Navbar
        activePanel={activePanel}
        onOpenImagePanel={openImagePanel}
        onOpenImageModel={openImageModel}
        onOpenVideoPanel={openVideoPanel}
        onOpenAudioPanel={openAudioPanel}
        onSetView={setView}
        audioMode={audioMode}
        onAudioModeChange={setAudioMode}
        audioModelIndex={audioModelIndex}
        onAudioModelIndexChange={setAudioModelIndex}
      />
      <SidePanel activePanel={activePanel} onClose={() => setActivePanel(null)} />

      <main className="flex-1">
        {activeView === "createImage" && (
          <CreateImageWorkspace
            onBack={() => setActiveView("default")}
            initialModel={selectedImageModel}
          />
        )}
        {activeView === "createAudio" && (
          <CreateAudioWorkspace
            onBack={() => setActiveView("default")}
            audioMode={audioMode}
            onAudioModeChange={setAudioMode}
            audioModelIndex={audioModelIndex}
            onAudioModelIndexChange={setAudioModelIndex}
          />
        )}
      </main>
    </div>
  );
}
