"use client";

import { useState } from "react";
import Navbar from "@/components/landing/Navbar";
import Sidebar from "./Sidebar";
import HeroBanner from "./HeroBanner";
import ControlButtons from "./ControlButtons";
import ModeToggle from "./ModeToggle";
import PromptBar from "./PromptBar";
import GenrePanel from "./GenrePanel";
import StyleModal from "./StyleModal";
import CameraSettings from "./CameraSettings";
import DockedPanelContainer from "./DockedPanelContainer";
import { getModel, type CinemaStudioSettings } from "./cinemaStudioData";

type ModalKey = "genre" | "style" | "camera" | null;

export default function CinemaStudioWorkspace() {
  // Core settings
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"image" | "video">("video");
  const [model, setModel] = useState("cinema-3.5");
  const [genre, setGenre] = useState<string | undefined>();
  const [style, setStyle] = useState<NonNullable<CinemaStudioSettings["style"]>>({});
  const [camera, setCamera] = useState<NonNullable<CinemaStudioSettings["camera"]>>({});
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("1080p");
  const [duration, setDuration] = useState(8);
  const [batch, setBatch] = useState("3/4");
  const [sound, setSound] = useState(true);

  // UI
  const [modal, setModal] = useState<ModalKey>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const selectedModel = getModel(model);

  // Selecting a model applies its model-specific default settings.
  const handleModelChange = (id: string) => {
    setModel(id);
    const next = getModel(id);
    // Apply the model's default duration (resolution stays mode-controlled).
    setDuration(
      next.defaultDuration ??
        (next.durations.includes(8) ? 8 : next.durations[0]),
    );
  };

  // Switching modes applies that mode's default model + controls.
  const handleModeChange = (next: "image" | "video") => {
    setMode(next);
    if (next === "image") {
      handleModelChange("cinematic-locations");
      setResolution("2K");
      setBatch("4/10");
    } else {
      handleModelChange("cinema-3.5");
      setResolution("1080p");
      setBatch("3/4");
    }
  };

  // Image credits are a flat 0.5; video credits come from the model's catalog value.
  const creditCost = mode === "image" ? 0.5 : selectedModel.baseCredits;

  const styleSelections = [
    ...(style.colorPalette ?? []),
    ...(style.lighting ?? []),
    ...(style.cameraMovement ?? []),
  ];
  const styleActive = styleSelections.length > 0;
  const styleLabel = styleActive
    ? (() => {
        const joined = styleSelections.join(", ");
        return joined.length > 22 ? `${joined.slice(0, 21)}...` : joined;
      })()
    : "Auto";
  const cameraActive =
    [camera.camera, camera.lens, camera.aperture].some(
      (v) => v && v !== "Auto",
    ) ||
    (camera.focalLength != null && camera.focalLength !== 35);

  // Genre/Style/Camera controls show only for Cinema Studio 3.5.
  const isCinema35 = selectedModel.id === "cinema-3.5";
  const isCinema = selectedModel.id.startsWith("cinema-");

  // Navbar requires handlers; on /generate these are inert (links still work).
  const noop = () => {};

  return (
    <div
      className="min-h-screen w-full bg-[#0a0a0a] text-white"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
        backgroundSize: "64px 64px",
      }}
    >
      <Navbar
        activePanel={null}
        onOpenImagePanel={noop}
        onOpenVideoPanel={noop}
        onOpenAudioPanel={noop}
        onSetView={noop}
      />

      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
      />
      <main
        className={`mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[1320px] flex-col items-center gap-2 px-4 pb-12 pt-[18vh] transition-[padding] duration-300 ease-out ${
          sidebarCollapsed ? "md:pl-[68px]" : "md:pl-[247px]"
        }`}
      >
        {/* Hero */}
        <div className="mb-10">
          <HeroBanner />
        </div>

        {/* Control buttons — Cinema Studio 3.5 only. Reserve the row height in every mode. */}
        <div className="flex min-h-[36px] w-full items-center justify-center">
          {isCinema35 && (
            <ControlButtons
              genre={genre ?? "General"}
              styleLabel={styleLabel}
              cameraLabel={cameraActive ? "Custom" : "Auto"}
              genreActive={!!genre}
              styleActive={styleActive}
              cameraActive={cameraActive}
              onOpenGenre={() => setModal("genre")}
              onOpenStyle={() => setModal("style")}
              onOpenCamera={() => setModal("camera")}
            />
          )}
        </div>

        {/* Mode toggle (left sidebar) + prompt bar */}
        <div className="relative z-50 mx-auto flex w-full max-w-[1040px] items-end justify-center gap-1">
          <ModeToggle mode={mode} onChange={handleModeChange} />
          <PromptBar
          prompt={prompt}
          onPromptChange={setPrompt}
          model={model}
          onModelChange={handleModelChange}
          mode={mode}
          aspectRatio={aspectRatio}
          onAspectRatioChange={setAspectRatio}
          resolution={resolution}
          onResolutionChange={setResolution}
          duration={duration}
          durations={selectedModel.durations}
          onDurationChange={setDuration}
          batch={batch}
          onBatchChange={setBatch}
          sound={sound}
          onSoundChange={setSound}
          creditCost={creditCost}
          onGenerate={noop}
          />
        </div>
      </main>

      {/* Docked Panels — Cinema Studio 3.5 only */}
      {isCinema35 && (
        <>
          <DockedPanelContainer open={modal === "genre"}>
            <GenrePanel
              open={modal === "genre"}
              onClose={() => setModal(null)}
              selected={genre}
              onSelect={setGenre}
              docked={true}
            />
          </DockedPanelContainer>
          <DockedPanelContainer open={modal === "style"}>
            <StyleModal
              open={modal === "style"}
              onClose={() => setModal(null)}
              value={style}
              onChange={setStyle}
              docked={true}
            />
          </DockedPanelContainer>
          <DockedPanelContainer open={modal === "camera"}>
            <CameraSettings
              open={modal === "camera"}
              onClose={() => setModal(null)}
              camera={camera}
              onCameraChange={setCamera}
              genre={genre ?? "General"}
              styleLabel={styleLabel}
              docked={true}
            />
          </DockedPanelContainer>
        </>
      )}
    </div>
  );
}
