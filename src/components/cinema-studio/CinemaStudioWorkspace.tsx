"use client";

import { useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Navbar from "@/components/landing/Navbar";
import CinemaStudioHoverSidebar from "./CinemaStudioHoverSidebar";
import HeroBanner from "./HeroBanner";
import ControlButtons from "./ControlButtons";
import ModeToggle from "./ModeToggle";
import PromptBar from "./PromptBar";
import GenrePanel from "./GenrePanel";
import StyleModal from "./StyleModal";
import CameraSettings from "./CameraSettings";
import Cinema3DirectorsPanel from "./Cinema3DirectorsPanel";
import CinemaStudio25DirectorPanel from "./CinemaStudio25DirectorPanel";
import DockedPanelContainer from "./DockedPanelContainer";
import ImageForm from "@/components/image-tools/ImageForm";
import HeroSection from "@/components/image-tools/HeroSection";
import NanoBananaProDrawWorkspace from "@/components/image-tools/NanoBananaProDrawWorkspace";
import { getModel, type CinemaStudioSettings } from "./cinemaStudioData";
import type { GenerateVideoRequest } from "@/lib/jobs";

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
  // Image mode — reuses /generate/image's own HeroSection + ImageForm
  // wholesale (same model list, popovers, capability system) instead of a
  // Cinema-Studio-specific composer. Kept independent from `model` (video)
  // since the two systems use different model-id schemes.
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

      <CinemaStudioHoverSidebar />
      <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[1320px] flex-col items-center gap-2 px-4 pb-12 pt-[18vh] md:pl-[68px]">
        {/* Keep both mode heroes in the same grid cell so their shared slot
            always reserves the larger height and cannot push the composer. */}
        <div className="mb-10 grid w-full">
          <div
            className={`col-start-1 row-start-1 ${
              mode === "image"
                ? "visible opacity-100"
                : "invisible pointer-events-none opacity-0"
            }`}
            aria-hidden={mode !== "image"}
          >
            <HeroSection selectedModel={imageModel} />
          </div>
          <div
            className={`col-start-1 row-start-1 ${
              mode === "video"
                ? "visible opacity-100"
                : "invisible pointer-events-none opacity-0"
            }`}
            aria-hidden={mode !== "video"}
          >
            <HeroBanner />
          </div>
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
          {/*
            Composer row: ModeToggle is a fixed-width sibling, outside the
            width-shared column. For Cinema Studio 2.5, Director Panel and
            PromptBar live inside ONE flex-1 column (`generation-composer-stack`)
            so they always inherit the exact same width — neither panel has its
            own independent max-width, which is what caused the previous
            misalignment (ModeToggle used to share the same max-w-[1040px] row
            as PromptBar while Director Panel had that same max-width alone).
          */}
          <div className="relative z-50 mx-auto flex w-full max-w-[1040px] items-end gap-2" ref={promptBarWrapperRef}>
            <ModeToggle mode={mode} onChange={handleModeChange} />

            {mode === "image" ? (
              <ImageForm
                embedded
                externalModel={imageModel}
                onExternalModelChange={setImageModel}
                isDrawOpen={isDrawOpen}
                onDrawOpen={setIsDrawOpen}
              />
            ) : isCinema25 ? (
              <div className="flex min-w-0 flex-1 flex-col gap-2">
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
