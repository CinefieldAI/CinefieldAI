"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Volume2, VolumeX } from "lucide-react";
import Navbar from "@/components/landing/Navbar";
import CinemaGenerateSidebar from "./CinemaGenerateSidebar";
import CinemaStudioHoverSidebar from "./CinemaStudioHoverSidebar";
import CommunitySection from "./CommunitySection";
import ControlButtons from "./ControlButtons";
import ModeToggle from "./ModeToggle";
import PromptBar from "./PromptBar";
import GenrePanel from "./GenrePanel";
import StyleModal from "./StyleModal";
import CameraSettings from "./CameraSettings";
import Cinema3DirectorsPanel from "./Cinema3DirectorsPanel";
import CinemaStudio25DirectorPanel from "./CinemaStudio25DirectorPanel";
import DockedPanelContainer from "./DockedPanelContainer";
import CinemaStudioImagePanel from "./CinemaStudioImagePanel";
import ImageForm from "@/components/image-tools/ImageForm";
import NanoBananaProDrawWorkspace from "@/components/image-tools/NanoBananaProDrawWorkspace";
import { getModel, type CinemaStudioSettings } from "./cinemaStudioData";
import type { GenerateVideoRequest } from "@/lib/jobs";

type ModalKey = "genre" | "style" | "camera" | null;

export default function CinemaStudioWorkspace() {
  const searchParams = useSearchParams();
  const promptBarWrapperRef = useRef<HTMLDivElement>(null);
  const heroVideoRef = useRef<HTMLVideoElement>(null);
  const [isHeroVideoMuted, setIsHeroVideoMuted] = useState(true);

  // Sidebar state
  const [activeSidebarView, setActiveSidebarView] = useState<"home" | "allGenerations" | "favorites">("home");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(52);

  const toggleHeroVideoMute = () => {
    if (heroVideoRef.current) {
      heroVideoRef.current.muted = !heroVideoRef.current.muted;
      setIsHeroVideoMuted(heroVideoRef.current.muted);
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const delay = `-${((Date.now() % 20000) / 1000).toFixed(2)}s`;
      document.documentElement.style.setProperty("--global-pulse-delay", delay);
    }
  }, []);

  // Core settings
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"image" | "video">("video");
  const [model, setModel] = useState(() => {
    return searchParams.get("model") || "cinema-3.5";
  });
  const [imageModel, setImageModel] = useState("nano-banana-pro");
  const [isDrawOpen, setIsDrawOpen] = useState(false);

  const [genre, setGenre] = useState<string | undefined>();
  const [style, setStyle] = useState<NonNullable<CinemaStudioSettings["style"]>>({});
  const [camera, setCamera] = useState<NonNullable<CinemaStudioSettings["camera"]>>({});
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("1080p");
  const [quality] = useState("720p");
  const [duration, setDuration] = useState(8);
  const [batch, setBatch] = useState("3/4");
  const [sound, setSound] = useState(true);

  // Kling 3.0 Motion Control advanced settings
  const [klingAdvancedPrompt, setKlingAdvancedPrompt] = useState("");

  // Kling 3.0 Turbo — deliberately isolated from the shared aspectRatio/resolution
  // state (and from every other model) so switching models never overwrites it.
  const [kling3TurboSettings, setKling3TurboSettings] = useState<{
    aspectRatio: string;
    resolution: string;
    startFrame: string | null;
  }>({ aspectRatio: "1:1", resolution: "720p", startFrame: null });

  // Cinema Studio 3.0 Director's Panel settings
  const [cinema3Genre, setCinema3Genre] = useState("General");
  const [cinema3CameraMovement, setCinema3CameraMovement] = useState("Auto");
  const [cinema3SpeedRamp, setCinema3SpeedRamp] = useState("Auto");

  // Cinema Studio 2.5 Director Panel settings — isolated from Cinema Studio 3.0's panel above.
  const [cinema25DirectorPanelOpen, setCinema25DirectorPanelOpen] = useState(false);
  const [cinema25References, setCinema25References] = useState<(string | null)[]>([
    null,
    null,
    null,
  ]);
  const [cinema25ReferencesPopoverOpen, setCinema25ReferencesPopoverOpen] = useState(false);
  const [cinema25MovementIndex, setCinema25MovementIndex] = useState(0);
  const [cinema25SpeedRampIndex, setCinema25SpeedRampIndex] = useState(0);
  const [cinema25SpeedRampPoints, setCinema25SpeedRampPoints] = useState([50, 50, 50, 50, 50]);

  // UI
  const [modal, setModal] = useState<ModalKey>(null);
  const [isGenerating, setIsGenerating] = useState(false);

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
  const isCinema25 = selectedModel.id === "cinema-2.5";

  // Navbar requires handlers; on /generate these are inert (links still work).
  const noop = () => {};

  // Generate video handler
  const handleGenerate = async () => {
    try {
      setIsGenerating(true);
      const isKling3MotionControl = model === "kling-3.0-motion-control";
      const isKling3Turbo = model === "kling-3.0-turbo";
      const effectivePrompt = prompt || klingAdvancedPrompt;

      if (!effectivePrompt.trim()) {
        console.warn("Prompt is empty");
        return;
      }

      // Genre/Style/Camera are only surfaced in the UI for Cinema Studio 3.5
      // (ControlButtons + docked panels). Omitting them for every other model
      // — including other Cinema Studio versions — avoids sending stale
      // values left over from a prior 3.5 session.
      // Kling 3.0 Turbo uses its own isolated aspectRatio/resolution rather
      // than the shared state (see kling3TurboSettings above).
      const payload: GenerateVideoRequest = {
        model,
        prompt: isKling3MotionControl ? undefined : effectivePrompt,
        advancedPrompt: isKling3MotionControl ? effectivePrompt : undefined,
        resolution: isKling3Turbo ? kling3TurboSettings.resolution : resolution,
        aspectRatio: isKling3Turbo ? kling3TurboSettings.aspectRatio : aspectRatio,
        duration,
        batchSize: batch ? parseInt(batch.split("/")[0]) : undefined,
        sound,
        quality,
        genre: isCinema35 ? genre : undefined,
        style: isCinema35 ? style : undefined,
        camera: isCinema35 ? camera : undefined,
      };

      const response = await fetch("/api/generate-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
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
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#090a0b] text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[180px] h-[560px] bg-[radial-gradient(ellipse_at_top,rgba(217,119,87,0.10),rgba(25,28,29,0.34)_34%,rgba(9,10,11,0.96)_68%,rgba(9,10,11,0)_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[300px] h-[420px] bg-[linear-gradient(180deg,rgba(9,10,11,0)_0%,rgba(9,10,11,0.72)_24%,rgba(9,10,11,0.96)_58%,rgba(9,10,11,0)_100%)]"
      />
      <Navbar
        activePanel={null}
        onOpenImagePanel={noop}
        onOpenVideoPanel={noop}
        onOpenAudioPanel={noop}
        onSetView={noop}
      />

      <CinemaGenerateSidebar
        activeView={activeSidebarView}
        onViewChange={(view) => setActiveSidebarView(view as any)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        onWidthChange={setSidebarWidth}
      />

      {/* Hero — the Blueface promo fills this band, with the composer sitting
          over its lower edge (matches the reference: video on top, cards on
          black underneath). This section is its own independent panel next
          to the sidebar — it does not live-follow the sidebar while it's
          being drag-resized, only once the drag settles (see
          `onWidthChange`/`sidebarWidth` in CinemaGenerateSidebar). */}
      <section
        className="relative z-10 overflow-visible rounded-[1rem] border border-white/[0.04] bg-black transition-[margin-left] duration-300 ease-out md:ml-[calc(var(--cinema-sidebar-w)+16px)]"
        style={{ ["--cinema-sidebar-w" as string]: `${sidebarWidth}px` }}
      >
        <video
          ref={heroVideoRef}
          autoPlay
          muted={isHeroVideoMuted}
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          onTimeUpdate={(e) => {
            const vid = e.currentTarget;
            if (vid.duration && vid.currentTime >= vid.duration - 0.2) {
              vid.currentTime = 0;
              vid.play().catch(() => {});
            }
          }}
          className="absolute inset-0 h-full w-full object-cover"
        >
          <source src="/Blueface - Box Training - Promo - 4K.mp4" type="video/mp4" />
        </video>

        {/* Soft gradient overlays blending video smoothly into black background — transition pulled lower down */}
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-[#090a0b]/80 pointer-events-none" />
        <div aria-hidden="true" className="absolute -bottom-24 left-0 right-0 h-56 bg-gradient-to-b from-transparent via-[#090a0b]/92 to-[#090a0b] pointer-events-none" />

        {/* Hero Headline Overlay matching reference screenshot exactly */}
        <div
          className="pointer-events-none absolute inset-x-0 top-32 md:top-36 z-5 flex justify-center px-4"
          style={{ opacity: 1, transition: "opacity 300ms ease-out" }}
        >
          <h1 className="text-center text-2xl sm:text-3xl md:text-[34px] font-black uppercase leading-tight tracking-wider text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.9)] [font-feature-settings:'ss04'_1]">
            <span className="block">Direct anything</span>
            <span className="block">you imagine</span>
          </h1>
        </div>

        {/* Mute/Unmute audio button in top right corner */}
        <button
          type="button"
          onClick={toggleHeroVideoMute}
          aria-label={isHeroVideoMuted ? "Unmute video" : "Mute video"}
          className="absolute top-20 right-6 z-40 flex size-10 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/80 backdrop-blur-md transition-all hover:bg-black/80 hover:text-white active:scale-95 shadow-lg"
        >
          {isHeroVideoMuted ? (
            <VolumeX className="size-4 text-white/70" />
          ) : (
            <Volume2 className="size-4 text-white" />
          )}
        </button>

      <main
        className="relative z-10 mx-auto flex min-h-[520px] w-full max-w-[1320px] flex-col items-center justify-end gap-2 px-4 pb-10 pt-8"
      >
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
          {/*
            Composer row: ModeToggle is a fixed-width sibling, outside the
            width-shared column. For Cinema Studio 2.5, Director Panel and
            PromptBar live inside ONE flex-1 column (`generation-composer-stack`)
            so they always inherit the exact same width — neither panel has its
            own independent max-width, which is what caused the previous
            misalignment (ModeToggle used to share the same max-w-[1040px] row
            as PromptBar while Director Panel had that same max-width alone).
          */}
          <div className="relative z-50 mx-auto flex w-full max-w-[962px] items-end gap-2" ref={promptBarWrapperRef}>
            <ModeToggle mode={mode} onChange={handleModeChange} />

            {mode === "image" ? (
              <div key="image-mode-container" className="flex min-w-0 flex-1 flex-col transition-all duration-300 ease-out animate-in fade-in-0 slide-in-from-bottom-2">
                <PromptBar
                  prompt={prompt}
                  onPromptChange={setPrompt}
                  model={imageModel}
                  onModelChange={setImageModel}
                  mode="image"
                  aspectRatio={aspectRatio}
                  onAspectRatioChange={setAspectRatio}
                  resolution={resolution}
                  onResolutionChange={setResolution}
                  duration={duration}
                  durations={[5, 10]}
                  onDurationChange={setDuration}
                  batch={batch}
                  onBatchChange={setBatch}
                  sound={sound}
                  onSoundChange={setSound}
                  creditCost={10}
                  onGenerate={handleGenerate}
                  isGenerating={isGenerating}
                  klingAdvancedPrompt={klingAdvancedPrompt}
                  onKlingAdvancedPromptChange={setKlingAdvancedPrompt}
                  kling3TurboSettings={kling3TurboSettings}
                  onKling3TurboSettingsChange={setKling3TurboSettings}
                  cinema25References={cinema25References}
                  onCinema25AssignReference={(slotIndex, url) =>
                    setCinema25References((s) => {
                      const next = [...s];
                      next[slotIndex] = url;
                      return next;
                    })
                  }
                  cinema25ReferencesPopoverOpen={cinema25ReferencesPopoverOpen}
                  onCinema25ReferencesPopoverOpenChange={setCinema25ReferencesPopoverOpen}
                />
              </div>
            ) : isCinema25 ? (
              <div key="cinema25-mode-container" className="flex min-w-0 flex-1 flex-col gap-2 transition-all duration-300 ease-out animate-in fade-in-0 slide-in-from-bottom-2">
                <CinemaStudio25DirectorPanel
                  isOpen={cinema25DirectorPanelOpen}
                  onToggle={() => setCinema25DirectorPanelOpen((v) => !v)}
                  references={cinema25References}
                  onAssignReference={(slotIndex, url) =>
                    setCinema25References((s) => {
                      const next = [...s];
                      next[slotIndex] = url;
                      return next;
                    })
                  }
                  movementIndex={cinema25MovementIndex}
                  onMovementIndexChange={setCinema25MovementIndex}
                  speedRampIndex={cinema25SpeedRampIndex}
                  onSpeedRampIndexChange={setCinema25SpeedRampIndex}
                  speedRampPoints={cinema25SpeedRampPoints}
                  onSpeedRampPointsChange={setCinema25SpeedRampPoints}
                  duration={duration}
                  onDurationChange={setDuration}
                />
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
                  onGenerate={handleGenerate}
                  isGenerating={isGenerating}
                  klingAdvancedPrompt={klingAdvancedPrompt}
                  onKlingAdvancedPromptChange={setKlingAdvancedPrompt}
                  kling3TurboSettings={kling3TurboSettings}
                  onKling3TurboSettingsChange={setKling3TurboSettings}
                  cinema25References={cinema25References}
                  onCinema25AssignReference={(slotIndex, url) =>
                    setCinema25References((s) => {
                      const next = [...s];
                      next[slotIndex] = url;
                      return next;
                    })
                  }
                  cinema25ReferencesPopoverOpen={cinema25ReferencesPopoverOpen}
                  onCinema25ReferencesPopoverOpenChange={setCinema25ReferencesPopoverOpen}
                />
              </div>
            ) : (
              <div key="video-mode-container" className="flex min-w-0 flex-1 flex-col transition-all duration-300 ease-out animate-in fade-in-0 slide-in-from-bottom-2">
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
                  durations={
                    model === "gemini-omni-flash"
                      ? [4, 6, 8, 10]
                      : model === "kling-3.0-omni-edit" || model === "kling-o1-video-edit"
                        ? [3, 4, 5, 6, 7, 8, 9, 10]
                        : model === "sora-2" ||
                            model === "sora-2-pro" ||
                            model === "sora-2-max" ||
                            model === "sora-2-pro-max"
                          ? [4, 8, 12]
                          : selectedModel.durations
                  }
                  onDurationChange={setDuration}
                  batch={batch}
                  onBatchChange={setBatch}
                  sound={sound}
                  onSoundChange={setSound}
                  creditCost={creditCost}
                  onGenerate={handleGenerate}
                  isGenerating={isGenerating}
                  klingAdvancedPrompt={klingAdvancedPrompt}
                  onKlingAdvancedPromptChange={setKlingAdvancedPrompt}
                  kling3TurboSettings={kling3TurboSettings}
                  onKling3TurboSettingsChange={setKling3TurboSettings}
                  cinema25References={cinema25References}
                  onCinema25AssignReference={(slotIndex, url) =>
                    setCinema25References((s) => {
                      const next = [...s];
                      next[slotIndex] = url;
                      return next;
                    })
                  }
                  cinema25ReferencesPopoverOpen={cinema25ReferencesPopoverOpen}
                  onCinema25ReferencesPopoverOpenChange={setCinema25ReferencesPopoverOpen}
                />
              </div>
            )}
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
      </section>

      {/* Community grid — plain black, directly under the video hero. */}
      <CommunitySection sidebarWidth={sidebarWidth} />

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

      {/* Nano Banana Pro's Draw workspace overlay — same as /generate/image. */}
      {mode === "image" && imageModel === "nano-banana-pro" && (
        <NanoBananaProDrawWorkspace isOpen={isDrawOpen} onClose={() => setIsDrawOpen(false)} />
      )}
    </div>
  );
}
