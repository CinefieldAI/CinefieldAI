"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Volume2, VolumeX, Paperclip, X } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { useClerkSupabaseClient } from "@/lib/supabase/useClerkSupabaseClient";
import type { Project, GenerationInsertPayload } from "@/types/database";
import {
  ALLOWED_INPUT_MIME_TYPES,
  MAX_INPUT_FILE_SIZE,
  buildInputStoragePath,
} from "@/lib/storageUpload";
import {
  mapCinemaModeToGenerationType,
  deriveProviderFromModelId,
} from "@/lib/cinemaGenerationMapping";
import { isSupportedNanoBananaModel } from "@/lib/gemini/geminiModelMapping";
import {
  isMockOrchestrationModel,
  getMockModelGenerationType,
  MOCK_PROVIDER_ID,
} from "@/lib/orchestration/mock-models";
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

type ModalKey = "genre" | "style" | "camera" | null;

type GenerationFlowStatus =
  | "idle"
  | "uploading"
  | "queued"
  | "processing"
  | "success"
  | "error";

export default function CinemaStudioWorkspace() {
  const searchParams = useSearchParams();
  const promptBarWrapperRef = useRef<HTMLDivElement>(null);
  const { user, isLoaded: userLoaded } = useUser();
  const { supabase, isSignedIn } = useClerkSupabaseClient();
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const generateInFlightRef = useRef(false);
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

  /**
   * Development-only mock orchestration override.
   *
   * `?model=mock-image` forces the model used for the generation row and for
   * orchestration, independent of the model picker. The picker keeps its own
   * state and its existing fallback label — it is never modified — because
   * mock ids are deliberately absent from the visible model catalog, and any
   * picker interaction would otherwise overwrite a URL-seeded state value.
   *
   * Null unless the URL explicitly names a registered mock model, so no real
   * model can ever be redirected to the Mock Provider.
   */
  const mockModelOverride = useMemo(() => {
    const requested = searchParams.get("model");
    return requested && isMockOrchestrationModel(requested) ? requested : null;
  }, [searchParams]);

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

  // Supabase generation queueing — active project, attachment, and flow feedback.
  // Additive only: does not alter any existing prompt bar UI or state above.
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [flowStatus, setFlowStatus] = useState<GenerationFlowStatus>("idle");
  const [flowMessage, setFlowMessage] = useState<string | null>(null);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);

  // Nano Banana 2 Lite's "Thinking" control — lifted here (from PromptBar's
  // former local state) so its current value can be captured into
  // generation metadata when queuing a generation.
  const [nanoBanana2LiteThinking, setNanoBanana2LiteThinking] = useState<
    "High" | "Minimal"
  >("High");

  // Auto-select the user's most recently created project — no project
  // picker exists on this page today, so this reuses the same "most recent
  // first" convention already established in /test/generations-storage.
  useEffect(() => {
    if (!isSignedIn || !supabase) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1);

      if (cancelled) return;

      if (!error && data && data.length > 0) {
        setActiveProject(data[0] as Project);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isSignedIn, supabase]);

  const handleAttachmentSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_INPUT_MIME_TYPES.includes(file.type)) {
      setFlowStatus("error");
      setFlowMessage(`File type not allowed: ${file.type || "unknown"}`);
      return;
    }
    if (file.size > MAX_INPUT_FILE_SIZE) {
      setFlowStatus("error");
      setFlowMessage("File exceeds the 50 MB limit");
      return;
    }

    setFlowStatus("idle");
    setFlowMessage(null);
    setAttachedFile(file);
  };

  const handleRemoveAttachment = () => {
    setAttachedFile(null);
    if (flowStatus === "error") {
      setFlowStatus("idle");
      setFlowMessage(null);
    }
  };

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

  // Queues one generation row in Supabase (and optionally uploads an
  // attachment to generation-inputs first). Does not call any AI provider,
  // create a worker, or produce an output — this only records the request.
  const handleGenerate = async () => {
    if (generateInFlightRef.current) return;

    if (!userLoaded || !user) {
      setFlowStatus("error");
      setFlowMessage("Please sign in to generate.");
      return;
    }
    if (!supabase) {
      setFlowStatus("error");
      setFlowMessage("Not connected. Please try again.");
      return;
    }
    if (!activeProject) {
      setFlowStatus("error");
      setFlowMessage("No project available. Create a project first.");
      return;
    }

    const effectivePrompt = (prompt || klingAdvancedPrompt).trim();
    if (!effectivePrompt && !attachedFile) {
      setFlowStatus("error");
      setFlowMessage("Enter a prompt or attach a file.");
      return;
    }

    generateInFlightRef.current = true;
    setIsGenerating(true);
    setFlowStatus(attachedFile ? "uploading" : "queued");
    setFlowMessage(null);

    let uploadedPath: string | null = null;

    try {
      // The dev mock override wins over the picker so the inserted row and
      // the orchestration run always agree. Without an override this is
      // exactly the previous behavior for every real model.
      const effectiveModel = mockModelOverride ?? (mode === "image" ? imageModel : model);
      const mockGenerationType = getMockModelGenerationType(effectiveModel);
      const generationType = mockGenerationType ?? mapCinemaModeToGenerationType(mode);
      const provider = mockGenerationType
        ? MOCK_PROVIDER_ID
        : deriveProviderFromModelId(effectiveModel);

      if (attachedFile) {
        const path = buildInputStoragePath(
          user.id,
          activeProject.id,
          attachedFile.name
        );
        const { error: uploadError } = await supabase.storage
          .from("generation-inputs")
          .upload(path, attachedFile, { cacheControl: "3600", upsert: false });

        if (uploadError) {
          setFlowStatus("error");
          setFlowMessage(`Upload failed: ${uploadError.message}`);
          return;
        }
        uploadedPath = path;
        setFlowStatus("queued");
      }

      const metadata: Record<string, unknown> = {
        source_page: "/generate",
        ui_mode: mode,
        aspect_ratio: aspectRatio,
        resolution,
        image_count: batch,
      };
      if (effectiveModel === "nano-banana-2-lite") {
        metadata.thinking = nanoBanana2LiteThinking;
      }
      if (attachedFile && uploadedPath) {
        metadata.original_file_name = attachedFile.name;
        metadata.file_size = attachedFile.size;
        metadata.mime_type = attachedFile.type;
        metadata.storage_bucket = "generation-inputs";
        metadata.storage_object_path = uploadedPath;
      }

      const payload: GenerationInsertPayload = {
        project_id: activeProject.id,
        generation_type: generationType,
        provider,
        model: effectiveModel,
        prompt: effectivePrompt,
        negative_prompt: null,
        input_url: uploadedPath,
        metadata,
      };

      const { data, error: insertError } = await supabase
        .from("generations")
        .insert([payload])
        .select()
        .single();

      if (insertError) {
        if (uploadedPath) {
          await supabase.storage.from("generation-inputs").remove([uploadedPath]);
        }
        setFlowStatus("error");
        setFlowMessage(`Failed to queue generation: ${insertError.message}`);
        return;
      }

      const generationId = String(data.id);

      // Cinefield mock orchestration — development-only. Runs ONLY when the
      // model id is one of the explicit mock registry entries, which no
      // production model picker entry uses. Every real model falls through
      // to its existing behavior untouched.
      if (isMockOrchestrationModel(effectiveModel)) {
        setFlowStatus("processing");
        setFlowMessage(null);
        setResultImageUrl(null);

        try {
          const execResponse = await fetch("/api/orchestration/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ generationId }),
          });
          const execJson = await execResponse.json();

          if (!execResponse.ok || execJson.status !== "completed") {
            setFlowStatus("error");
            setFlowMessage(
              typeof execJson.error === "string" ? execJson.error : "Mock orchestration failed."
            );
          } else {
            const firstOutput = Array.isArray(execJson.outputs) ? execJson.outputs[0] : null;
            setFlowStatus("success");
            setFlowMessage(
              "Cinefield mock orchestration test completed. No real AI provider was used."
            );
            setResultImageUrl(
              firstOutput && typeof firstOutput.signedUrl === "string"
                ? firstOutput.signedUrl
                : null
            );
          }
        } catch {
          setFlowStatus("error");
          setFlowMessage("Mock orchestration failed. Please try again.");
        }

        setAttachedFile(null);
        return;
      }

      // Gemini image generation runs only for the three Nano Banana models
      // in Image mode. Every other model/mode keeps the exact prior
      // behavior: the row stays queued and no server execution is triggered.
      if (mode === "image" && isSupportedNanoBananaModel(effectiveModel)) {
        setFlowStatus("processing");
        setFlowMessage(null);
        setResultImageUrl(null);

        try {
          const execResponse = await fetch(`/api/generations/${generationId}/execute`, {
            method: "POST",
          });
          const execJson = await execResponse.json();

          if (!execResponse.ok || execJson.status !== "completed") {
            setFlowStatus("error");
            setFlowMessage(
              typeof execJson.error === "string" ? execJson.error : "Generation failed."
            );
          } else {
            setFlowStatus("success");
            setFlowMessage(
              typeof execJson.warning === "string"
                ? `Generation completed. ${execJson.warning}`
                : "Generation completed."
            );
            setResultImageUrl(typeof execJson.signedUrl === "string" ? execJson.signedUrl : null);
          }
        } catch {
          setFlowStatus("error");
          setFlowMessage("Generation failed. Please try again.");
        }
      } else {
        setFlowStatus("success");
        setFlowMessage(`Generation queued (${generationId.slice(0, 8)}...)`);
      }

      setAttachedFile(null);
    } catch (error) {
      setFlowStatus("error");
      setFlowMessage(
        error instanceof Error ? error.message : "Failed to queue generation"
      );
    } finally {
      setIsGenerating(false);
      generateInFlightRef.current = false;
    }
  };

  return (
    <div className="min-h-screen w-full bg-black text-white">
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
        className="relative overflow-visible rounded-[1rem] border border-white/[0.04] bg-black transition-[margin-left] duration-300 ease-out md:ml-[calc(var(--cinema-sidebar-w)+16px)]"
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
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/80 pointer-events-none" />
        <div aria-hidden="true" className="absolute bottom-0 left-0 right-0 h-28 bg-gradient-to-t from-black via-black/90 to-transparent pointer-events-none" />

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
            Attachment control + generation flow feedback — additive only,
            rendered as a new sibling above the existing composer row. Does
            not modify PromptBar, ModeToggle, or any existing element below.
          */}
          <div className="relative z-50 mx-auto mb-2 flex w-full max-w-[962px] flex-wrap items-center gap-2">
            <input
              ref={attachmentInputRef}
              type="file"
              accept={ALLOWED_INPUT_MIME_TYPES.join(",")}
              className="hidden"
              onChange={handleAttachmentSelect}
            />
            <button
              type="button"
              onClick={() => attachmentInputRef.current?.click()}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-[rgba(4,4,5,0.98)] px-2.5 text-xs font-semibold text-neutral-300 transition-colors hover:border-[#D97757] hover:text-white"
            >
              <Paperclip className="size-3.5" />
              {attachedFile ? "Replace attachment" : "Attach file"}
            </button>

            {attachedFile && (
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[rgba(4,4,5,0.98)] px-2.5 py-1.5 text-xs text-neutral-300">
                <span className="max-w-[180px] truncate font-medium text-white">
                  {attachedFile.name}
                </span>
                <span className="text-neutral-500">
                  {attachedFile.type || "unknown"}
                </span>
                <span className="text-neutral-500">
                  {(attachedFile.size / (1024 * 1024)).toFixed(2)} MB
                </span>
                <button
                  type="button"
                  onClick={handleRemoveAttachment}
                  aria-label="Remove attachment"
                  className="text-neutral-400 hover:text-white"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}

            {flowStatus !== "idle" && (
              <span
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                  flowStatus === "error"
                    ? "border-red-500/30 bg-red-500/10 text-red-300"
                    : flowStatus === "success"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-white/10 bg-white/5 text-neutral-300"
                }`}
              >
                {flowStatus === "uploading"
                  ? "Uploading attachment..."
                  : flowStatus === "queued" && !flowMessage
                    ? "Queuing generation..."
                    : flowStatus === "processing"
                      ? "Processing..."
                      : flowMessage}
              </span>
            )}

            {/* Minimal result preview — Nano Banana Gemini output only.
                Additive only; no existing result area exists on this page. */}
            {resultImageUrl && (
              <div className="w-full basis-full">
                <img
                  src={resultImageUrl}
                  alt="Generated result"
                  className="max-h-64 rounded-lg border border-white/10 object-contain"
                />
              </div>
            )}
          </div>

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
                  nanoBanana2LiteThinking={nanoBanana2LiteThinking}
                  onNanoBanana2LiteThinkingChange={setNanoBanana2LiteThinking}
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
                  nanoBanana2LiteThinking={nanoBanana2LiteThinking}
                  onNanoBanana2LiteThinkingChange={setNanoBanana2LiteThinking}
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
                  nanoBanana2LiteThinking={nanoBanana2LiteThinking}
                  onNanoBanana2LiteThinkingChange={setNanoBanana2LiteThinking}
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
