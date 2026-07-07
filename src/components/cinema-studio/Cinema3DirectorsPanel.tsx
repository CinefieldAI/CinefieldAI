"use client";

import { useState, useEffect, useRef } from "react";
import { X, Check, Clapperboard } from "lucide-react";

type PanelView = "genre" | "camera" | "speed" | null;

interface Cinema3DirectorsPanelProps {
  selectedGenre?: string;
  onGenreSelect: (genre: string) => void;
  selectedCameraMovement?: string;
  onCameraMovementSelect: (movement: string) => void;
  selectedSpeedRamp?: string;
  onSpeedRampSelect: (ramp: string) => void;
}

const GENRE_OPTIONS = [
  { name: "General", video: "/assets/higgsfield/generate/cinema-3/genres/general.mp4" },
  { name: "Action", video: "/assets/higgsfield/generate/cinema-3/genres/action.mp4" },
  { name: "Horror", video: "/assets/higgsfield/generate/cinema-3/genres/horror.mp4" },
  { name: "Comedy", video: "/assets/higgsfield/generate/cinema-3/genres/comedy.mp4" },
  { name: "Noir", video: "/assets/higgsfield/generate/cinema-3/genres/noir.mp4" },
  { name: "Drama", video: "/assets/higgsfield/generate/cinema-3/genres/drama.mp4" },
  { name: "Epic", video: "/assets/higgsfield/generate/cinema-3/genres/epic.mp4" },
];

const CAMERA_MOVEMENT_OPTIONS = [
  { name: "Static", video: "/assets/higgsfield/generate/cinema-3/camera-movement/static.mp4" },
  { name: "Handheld", video: "/assets/higgsfield/generate/cinema-3/camera-movement/handheld.mp4" },
  { name: "Zoom Out", video: "/assets/higgsfield/generate/cinema-3/camera-movement/zoom-out.mp4" },
  { name: "Zoom in", video: "/assets/higgsfield/generate/cinema-3/camera-movement/zoom-in.mp4" },
  { name: "Camera follows", video: "/assets/higgsfield/generate/cinema-3/camera-movement/camera-follows.mp4" },
  { name: "Pan left", video: "/assets/higgsfield/generate/cinema-3/camera-movement/pan-left.mp4" },
  { name: "Pan right", video: "/assets/higgsfield/generate/cinema-3/camera-movement/pan-right.mp4" },
  { name: "Tilt up", video: "/assets/higgsfield/generate/cinema-3/camera-movement/tilt-up.mp4" },
  { name: "Tilt down", video: "/assets/higgsfield/generate/cinema-3/camera-movement/tilt-down.mp4" },
  { name: "Orbit around", video: "/assets/higgsfield/generate/cinema-3/camera-movement/orbit-around.mp4" },
  { name: "Dolly in", video: "/assets/higgsfield/generate/cinema-3/camera-movement/dolly-in.mp4" },
  { name: "Dolly out", video: "/assets/higgsfield/generate/cinema-3/camera-movement/dolly-out.mp4" },
  { name: "Jib up", video: "/assets/higgsfield/generate/cinema-3/camera-movement/jib-up.mp4" },
  { name: "Jib down", video: "/assets/higgsfield/generate/cinema-3/camera-movement/jib-down.mp4" },
  { name: "Drone shot", video: "/assets/higgsfield/generate/cinema-3/camera-movement/drone-shot.mp4" },
  { name: "Dolly left", video: "/assets/higgsfield/generate/cinema-3/camera-movement/dolly-left.mp4" },
  { name: "Dolly right", video: "/assets/higgsfield/generate/cinema-3/camera-movement/dolly-right.mp4" },
  { name: "360 roll", video: "/assets/higgsfield/generate/cinema-3/camera-movement/360-roll.mp4" },
];

const SPEED_RAMP_OPTIONS = [
  { name: "Auto", video: "/assets/higgsfield/generate/cinema-3/speed-ramp/auto.mp4" },
  { name: "Slow-mo", video: "/assets/higgsfield/generate/cinema-3/speed-ramp/slow-mo.mp4" },
  { name: "Ramp Up", video: "/assets/higgsfield/generate/cinema-3/speed-ramp/ramp-up.mp4" },
  { name: "Hero Moment", video: "/assets/higgsfield/generate/cinema-3/speed-ramp/hero-moment.mp4" },
];

function GridItem({
  name,
  video,
  isSelected,
  onClick,
}: {
  name: string;
  video: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex flex-col items-center gap-1.5 rounded-2xl overflow-hidden transition-all duration-200 ${
        isSelected ? "ring-2 ring-[#00e5ff]" : "hover:ring-1 hover:ring-[#00e5ff]/50"
      }`}
    >
      <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-black/30">
        <video
          src={video}
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full object-cover"
        />
        {isSelected && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <Check className="w-6 h-6 text-[#00e5ff]" />
          </div>
        )}
      </div>

      <span className={`text-xs font-semibold text-center truncate px-1 ${
        isSelected ? "text-[#00e5ff]" : "text-white"
      }`}>
        {name}
      </span>
    </button>
  );
}

function ControlChip({
  label,
  value,
  isActive,
  onClick,
}: {
  label: string;
  value: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="h-8 flex items-center gap-1 pl-1 pr-3 py-1 rounded-[18px] bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.08)] transition-colors cursor-pointer"
      style={{
        backgroundColor: isActive ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)",
      }}
    >
      <span className="relative size-6 rounded-full overflow-hidden shrink-0 bg-black/30" />
      <span className="text-xs font-medium text-white/60">{label}</span>
      <span className="text-xs font-medium text-white truncate max-w-[100px]">{value}</span>
    </button>
  );
}

export default function Cinema3DirectorsPanel({
  selectedGenre = "General",
  onGenreSelect,
  selectedCameraMovement = "Auto",
  onCameraMovementSelect,
  selectedSpeedRamp = "Auto",
  onSpeedRampSelect,
}: Cinema3DirectorsPanelProps) {
  const [currentPanel, setCurrentPanel] = useState<PanelView>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Outside-click close handler
  useEffect(() => {
    if (!currentPanel) return;

    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;

      // Don't close if clicking inside the panel
      if (panelRef.current?.contains(target)) return;

      // Close the grid panel
      setCurrentPanel(null);
    };

    // Use capture phase to catch clicks early
    document.addEventListener("mousedown", handleOutsideClick, true);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick, true);
    };
  }, [currentPanel]);

  const getPanelItems = () => {
    switch (currentPanel) {
      case "genre":
        return GENRE_OPTIONS;
      case "camera":
        return CAMERA_MOVEMENT_OPTIONS;
      case "speed":
        return SPEED_RAMP_OPTIONS;
      default:
        return [];
    }
  };

  const getPanelTitle = () => {
    switch (currentPanel) {
      case "genre":
        return "Genre";
      case "camera":
        return "Camera Movement";
      case "speed":
        return "Speed Ramp";
      default:
        return "";
    }
  };

  const handleSelectItem = (name: string) => {
    switch (currentPanel) {
      case "genre":
        onGenreSelect(name);
        break;
      case "camera":
        onCameraMovementSelect(name);
        break;
      case "speed":
        onSpeedRampSelect(name);
        break;
    }
  };

  const getSelectedValue = () => {
    switch (currentPanel) {
      case "genre":
        return selectedGenre;
      case "camera":
        return selectedCameraMovement;
      case "speed":
        return selectedSpeedRamp;
      default:
        return "";
    }
  };

  const panelItems = getPanelItems();
  const selectedValue = getSelectedValue();

  return (
    <div
      ref={panelRef}
      className="absolute left-1/2 -translate-x-1/2 z-[1000] w-[min(876px,calc(100vw-32px))] flex flex-col gap-1"
      style={{ bottom: "calc(100% + 12px)" }}
    >
      {/* Top Control Strip */}
      <div className="flex items-end justify-center overflow-visible pb-1 h-14 gap-1">
        {/* Group 1: Director's Panel + Genre */}
        <div className="flex items-center gap-0.5 rounded-[20px] bg-gradient-to-r from-[#141619] to-[#27292b] p-0.5">
          <div className="flex items-center gap-1.5 px-3 py-2 flex-shrink-0">
            <Clapperboard className="w-4 h-4 text-white/60" />
            <span className="text-xs font-medium text-white/60">Director's Panel</span>
          </div>

          <ControlChip
            label="Genre:"
            value={selectedGenre}
            isActive={currentPanel === "genre"}
            onClick={() => setCurrentPanel(currentPanel === "genre" ? null : "genre")}
          />
        </div>

        {/* Group 2: Camera Movement + Speed Ramp */}
        <div className="flex items-center gap-0.5 rounded-[20px] bg-gradient-to-r from-[#141619] to-[#27292b] p-0.5">
          <ControlChip
            label="Camera Movement:"
            value={selectedCameraMovement}
            isActive={currentPanel === "camera"}
            onClick={() => setCurrentPanel(currentPanel === "camera" ? null : "camera")}
          />

          <ControlChip
            label="Speed Ramp:"
            value={selectedSpeedRamp}
            isActive={currentPanel === "speed"}
            onClick={() => setCurrentPanel(currentPanel === "speed" ? null : "speed")}
          />
        </div>
      </div>

      {/* Content Panel */}
      {currentPanel && (
        <div
          className="rounded-[20px] p-1 backdrop-blur-[20px] flex flex-col min-h-0 overflow-hidden"
          style={{
            height: "27rem",
            maxHeight: "calc(100vh - 8rem)",
            background:
              "linear-gradient(0deg, rgba(21,21,21,0.88), rgba(21,21,21,0.88)), linear-gradient(41deg, rgba(101,189,235,0.24) 25.53%, rgba(101,189,235,0) 63.06%)",
            boxShadow:
              "0 12px 8px 0 rgba(0,0,0,0.20), inset 0 0 0 1px rgba(255,255,255,0.08)",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-3.5 flex-shrink-0">
            <h3 className="text-sm font-semibold text-white">{getPanelTitle()}</h3>
            <button
              onClick={() => setCurrentPanel(null)}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.12)] transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4 text-white/80" />
            </button>
          </div>

          {/* Grid Wrapper */}
          <div className="flex-1 overflow-hidden min-h-0 px-2 pb-2">
            <div className="w-full h-full overflow-y-auto hide-scrollbar">
              <div className="grid grid-cols-6 gap-2">
                {panelItems.map((item) => (
                  <GridItem
                    key={item.name}
                    name={item.name}
                    video={item.video}
                    isSelected={selectedValue === item.name}
                    onClick={() => handleSelectItem(item.name)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
