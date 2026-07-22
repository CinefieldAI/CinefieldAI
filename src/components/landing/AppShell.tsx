"use client";

import { useState } from "react";
import Navbar from "@/components/landing/Navbar";
import SidePanel from "@/components/landing/SidePanel";
import CreateAudioWorkspace from "@/components/landing/createAudio/CreateAudioWorkspace";
import type { ActiveView, PanelKey } from "@/components/landing/panelData";
import type { AudioMode } from "@/components/landing/audioMenuData";

interface AppShellProps {
  initialView?: ActiveView;
}

export default function AppShell({ initialView = "default" }: AppShellProps) {
  const [activePanel, setActivePanel] = useState<PanelKey | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>(initialView);

  // Shared Audio mode/model — single source of truth for both the top-nav
  // Audio mega-dropdown (Navbar) and the bottom rotary selector + prompt bar
  // (CreateAudioWorkspace). Lives here since Navbar and the workspace are
  // siblings that both need to read and write it.
  const [audioMode, setAudioMode] = useState<AudioMode>("voiceover");
  const [audioModelIndex, setAudioModelIndex] = useState(0);

  const openImagePanel = () => {
    setActivePanel("image");
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
