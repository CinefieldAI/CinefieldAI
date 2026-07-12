"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Navbar from "@/components/landing/Navbar";
import Sidebar from "./Sidebar";
import HeroBanner from "./HeroBanner";
import ControlButtons from "./ControlButtons";
import ModeToggle from "./ModeToggle";
import PromptBar from "./PromptBar";
import GenrePanel from "./GenrePanel";
import StyleModal from "./StyleModal";
import CameraSettings from "./CameraSettings";
import Cinema3DirectorsPanel from "./Cinema3DirectorsPanel";
import DockedPanelContainer from "./DockedPanelContainer";
import { getModel, type CinemaStudioSettings } from "./cinemaStudioData";

type ModalKey = "genre" | "style" | "camera" | null;

export default function CinemaStudioWorkspace() {
  const searchParams = useSearchParams();
  const promptBarWrapperRef = useRef<HTMLDivElement>(null);

  // Core settings
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"image" | "video">("video");
  const [model, setModel] = useState(() => {
    return searchParams.get("model") || "cinema-3.5";
  });
  const [genre, setGenre] = useState<string | undefined>();
  const [style, setStyle] = useState<NonNullable<CinemaStudioSettings["style"]>>({});
  const [camera, setCamera] = useState<NonNullable<CinemaStudioSettings["camera"]>>({});
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("1080p");
  const [quality, setQuality] = useState("720p");
  const [duration, setDuration] = useState(8);
  const [batch, setBatch] = useState("3/4");
  const [sound, setSound] = useState(true);

  // Kling 3.0 Motion Control advanced settings
  const [klingAdvancedPrompt, setKlingAdvancedPrompt] = useState("");

  // Cinema Studio 3.0 Director's Panel settings
  const [cinema3Genre, setCinema3Genre] = useState("General");
  const [cinema3CameraMovement, setCinema3CameraMovement] = useState("Auto");
  const [cinema3SpeedRamp, setCinema3SpeedRamp] = useState("Auto");

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
  const isCinema30 = selectedModel.id === "cinema-3.0";
  const isCinema = selectedModel.id.startsWith("cinema-");

  // Navbar requires handlers; on /generate these are inert (links still work).
  const noop = () => {};

  // Generate video handler
  const handleGenerate = async () => {
    try {
      const isKling3MotionControl = model === "kling-3.0-motion-control";
      const effectivePrompt = prompt || klingAdvancedPrompt;

      if (!effectivePrompt.trim()) {
        console.warn("Prompt is empty");
        return;
      }

      const response = await fetch("/api/generate-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt: isKling3MotionControl ? undefined : effectivePrompt,
          advancedPrompt: isKling3MotionControl ? effectivePrompt : undefined,
          resolution,
          aspectRatio,
          duration,
          batchSize: batch ? parseInt(batch.split("/")[0]) : undefined,
          sound,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error("Generation error:", error);
        return;
      }

      const result = await response.json();
      console.log("Video generation queued:", result);

      // Optionally show toast notification
      // toast.success(`Video queued: ${result.jobId}`);
    } catch (error) {
      console.error("Failed to generate video:", error);
      // toast.error("Failed to queue video generation");
    }
  };

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

        {/* Mode toggle (left sidebar) + prompt bar + Cinema 3.0 Panel */}
        <div className="relative w-full">
          <div className="relative z-50 mx-auto flex w-full max-w-[1040px] items-end justify-center gap-1" ref={promptBarWrapperRef}>
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
              quality={quality}
              onQualityChange={setQuality}
              duration={duration}
              durations={model === "gemini-omni-flash" ? [4, 6, 8, 10] : selectedModel.durations}
              onDurationChange={setDuration}
              batch={batch}
              onBatchChange={setBatch}
              sound={sound}
              onSoundChange={setSound}
              creditCost={creditCost}
              onGenerate={handleGenerate}
              klingAdvancedPrompt={klingAdvancedPrompt}
              onKlingAdvancedPromptChange={setKlingAdvancedPrompt}
            />
          </div>

          {/* Cinema Studio 3.0 Director's Panel - positioned above prompt bar */}
          {isCinema30 && (
            <Cinema3DirectorsPanel
              selectedGenre={cinema3Genre}
              onGenreSelect={setCinema3Genre}
              selectedCameraMovement={cinema3CameraMovement}
              onCameraMovementSelect={setCinema3CameraMovement}
              selectedSpeedRamp={cinema3SpeedRamp}
              onSpeedRampSelect={setCinema3SpeedRamp}
            />
          )}
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
