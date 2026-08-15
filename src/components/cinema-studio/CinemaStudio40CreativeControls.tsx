"use client";

import * as Popover from "@radix-ui/react-popover";
import { Plus, RotateCcw } from "lucide-react";
import Cinema25AssetsPicker from "./Cinema25AssetsPicker";
import {
  CINEMA40_CAMERAS,
  CINEMA40_ERAS,
  CINEMA40_LENSES,
  CINEMA40_MOVEMENT_TAGS,
  CINEMA40_TEMPO,
  COLOR_PALETTES,
  GENRES,
  LIGHTING,
} from "./cinemaStudioData";

export type Cinema40PanelId = "references" | "filmSetup" | "camera" | "colorPalette" | "lighting";

export interface Cinema40FilmSetup {
  genre: string;
  era: string;
  tempo: string;
}

export interface Cinema40Camera {
  camera: string;
  lens: string;
}

export interface CinemaStudio40Settings {
  references: string[];
  filmSetup: Cinema40FilmSetup;
  camera: Cinema40Camera;
  colorPalette: string;
  lighting: string;
}

interface CinemaStudio40CreativeControlsProps {
  settings: CinemaStudio40Settings;
  onFilmSetupChange: (next: Partial<Cinema40FilmSetup>) => void;
  onCameraChange: (next: Partial<Cinema40Camera>) => void;
  onColorPaletteChange: (value: string) => void;
  onLightingChange: (value: string) => void;
  onAddReference: (url: string) => void;
  onResetAll: () => void;
  /** Insert a `#Tag` movement into the prompt (Camera → Movement rows). */
  onAppendMovementTag: (tag: string) => void;

  /** Which pill's popover is open — lifted to the workspace so PromptBar's
   *  own "Camera movement" shortcut button can open this same popover from
   *  below instead of rendering a second, duplicate Movement list. */
  openPanel: Cinema40PanelId | null;
  onOpenPanelChange: (panel: Cinema40PanelId | null) => void;
  /** Which inner tab the Camera popover shows — also settable from PromptBar's
   *  shortcut button so it can jump straight to Movement. */
  cameraTab: "setup" | "movement";
  onCameraTabChange: (tab: "setup" | "movement") => void;
  /** Which inner tab the Film setup popover shows. */
  filmSetupTab: "genre" | "era" | "tempo";
  onFilmSetupTabChange: (tab: "genre" | "era" | "tempo") => void;

  /** Whether the shared Assets Picker (References) is open — also lifted so
   *  PromptBar's own leading "+"/"@" buttons can drive the same instance. */
  assetsPickerOpen: boolean;
  onAssetsPickerOpenChange: (open: boolean) => void;
  assetsPickerTab: "uploads" | "elements";
  onAssetsPickerTabChange: (tab: "uploads" | "elements") => void;

  portalContainer: HTMLElement | null;
}

const MAX_REFERENCES = 50;

/** Shared pill trigger styling — matches PromptBar.tsx's PILL constant. */
const PILL =
  "flex h-8 items-center gap-1.5 rounded-lg border border-[rgba(217,119,87,0.45)] bg-[rgba(4,4,5,0.98)] px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out hover:border-[#D97757] hover:bg-[rgba(16,16,17,0.98)] focus:outline-none";
const PILL_OPEN = "border-[#D97757] bg-[rgba(16,16,17,0.98)]";

/** Shared popover content chassis — same surface used by PromptBar's own
 *  "Shot Control" popover, so Cinema Studio 4.0's panels look native to the
 *  rest of /generate rather than inventing new design language. */
const POPOVER_CONTENT =
  "outline-none z-[100000] rounded-2xl shadow-[0_4px_4px_rgba(0,0,0,0.12)] border border-[rgba(217,217,217,0.04)] bg-[rgba(35,38,42,0.75)] backdrop-blur data-[state=closed]:animate-fade-out data-[side=bottom]:data-[state=open]:animate-popover-in-down data-[side=top]:data-[state=open]:animate-popover-in-up pointer-events-auto";

function PopoverHeader({ title, onReset }: { title: string; onReset: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-1">
      <span className="text-xs font-semibold text-white">{title}</span>
      <button
        type="button"
        onClick={onReset}
        className="flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 text-[11px] font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
      >
        <RotateCcw className="size-3" />
        Reset all
      </button>
    </div>
  );
}

function InnerTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-white/5 px-2 pb-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
            value === tab.id
              ? "bg-white/10 text-white"
              : "text-white/50 hover:bg-white/5 hover:text-white/80"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Flat grid of option buttons — Genre/Era/Tempo, Camera/Lens, Color palette, Lighting. */
function OptionGrid({
  options,
  value,
  onSelect,
}: {
  options: readonly string[];
  value: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5 p-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onSelect(option)}
          className={`truncate rounded-xl border px-2 py-2.5 text-center text-xs font-medium transition-colors ${
            value === option
              ? "border-[#D97757]/60 bg-[rgba(217,119,87,0.12)] text-white"
              : "border-white/[0.06] bg-white/[0.03] text-white/70 hover:border-white/15 hover:bg-white/[0.06] hover:text-white"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/** Camera → Movement tab: a scrollable list of "Put on prompt" tag rows. */
function MovementTagList({ onAppendMovementTag }: { onAppendMovementTag: (tag: string) => void }) {
  return (
    <div className="hide-scrollbar flex max-h-[280px] flex-col gap-1 overflow-y-auto p-2">
      {CINEMA40_MOVEMENT_TAGS.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={() => onAppendMovementTag(tag)}
          className="flex items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <span className="truncate">{tag}</span>
          <span className="shrink-0 rounded-full bg-white/5 px-2 py-1 text-[10px] font-semibold text-white/60">
            Put on prompt
          </span>
        </button>
      ))}
    </div>
  );
}

export default function CinemaStudio40CreativeControls({
  settings,
  onFilmSetupChange,
  onCameraChange,
  onColorPaletteChange,
  onLightingChange,
  onAddReference,
  onResetAll,
  onAppendMovementTag,
  openPanel,
  onOpenPanelChange,
  cameraTab,
  onCameraTabChange,
  filmSetupTab,
  onFilmSetupTabChange,
  assetsPickerOpen,
  onAssetsPickerOpenChange,
  assetsPickerTab,
  onAssetsPickerTabChange,
  portalContainer,
}: CinemaStudio40CreativeControlsProps) {
  const filmSetupSummary =
    settings.filmSetup.genre === "General" && settings.filmSetup.era === "Auto" && settings.filmSetup.tempo === "Auto"
      ? "Auto"
      : [settings.filmSetup.genre, settings.filmSetup.era].filter((v) => v && v !== "Auto" && v !== "General").join(", ") ||
        settings.filmSetup.genre;

  const cameraSummary =
    settings.camera.camera === "Auto" && settings.camera.lens === "Auto"
      ? "Auto"
      : [settings.camera.camera, settings.camera.lens].filter((v) => v !== "Auto").join(", ");

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 rounded-2xl px-1 py-1">
      {/* References */}
      <Popover.Root
        open={openPanel === "references"}
        onOpenChange={(open) => onOpenPanelChange(open ? "references" : null)}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={`References, ${settings.references.length} of ${MAX_REFERENCES}`}
            aria-haspopup="dialog"
            aria-expanded={openPanel === "references"}
            className={`${PILL} ${openPanel === "references" ? PILL_OPEN : ""} flex-col !items-start !gap-0 !py-1`}
          >
            <span className="text-[10px] font-medium leading-3 text-white/50">References</span>
            <span className="text-xs font-semibold leading-4 text-white">
              {settings.references.length}/{MAX_REFERENCES}
            </span>
          </button>
        </Popover.Trigger>
        <Popover.Portal container={portalContainer}>
          <Popover.Content
            side="top"
            align="start"
            sideOffset={8}
            className={`${POPOVER_CONTENT} w-[260px] p-2`}
          >
            <p className="px-1 pb-2 pt-1 text-xs text-white/50">
              Add up to {MAX_REFERENCES} reference images. Reopen this panel to add more.
            </p>
            <button
              type="button"
              onClick={() => {
                onAssetsPickerTabChange("uploads");
                onAssetsPickerOpenChange(true);
              }}
              disabled={settings.references.length >= MAX_REFERENCES}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="size-3.5" />
              Add reference
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {/* Film setup */}
      <Popover.Root
        open={openPanel === "filmSetup"}
        onOpenChange={(open) => onOpenPanelChange(open ? "filmSetup" : null)}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={`Film setup, ${filmSetupSummary}`}
            aria-haspopup="dialog"
            aria-expanded={openPanel === "filmSetup"}
            className={`${PILL} ${openPanel === "filmSetup" ? PILL_OPEN : ""} flex-col !items-start !gap-0 !py-1`}
          >
            <span className="text-[10px] font-medium leading-3 text-white/50">Film setup</span>
            <span className="max-w-[110px] truncate text-xs font-semibold leading-4 text-white">
              {filmSetupSummary}
            </span>
          </button>
        </Popover.Trigger>
        <Popover.Portal container={portalContainer}>
          <Popover.Content
            side="top"
            align="start"
            sideOffset={8}
            className={`${POPOVER_CONTENT} w-[300px]`}
          >
            <PopoverHeader title="Film setup" onReset={onResetAll} />
            <InnerTabs
              tabs={[
                { id: "genre", label: "Genre" },
                { id: "era", label: "Era" },
                { id: "tempo", label: "Tempo" },
              ]}
              value={filmSetupTab}
              onChange={onFilmSetupTabChange}
            />
            {filmSetupTab === "genre" && (
              <OptionGrid
                options={GENRES.map((g) => g.name)}
                value={settings.filmSetup.genre}
                onSelect={(genre) => onFilmSetupChange({ genre })}
              />
            )}
            {filmSetupTab === "era" && (
              <OptionGrid
                options={CINEMA40_ERAS}
                value={settings.filmSetup.era}
                onSelect={(era) => onFilmSetupChange({ era })}
              />
            )}
            {filmSetupTab === "tempo" && (
              <OptionGrid
                options={CINEMA40_TEMPO}
                value={settings.filmSetup.tempo}
                onSelect={(tempo) => onFilmSetupChange({ tempo })}
              />
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {/* Camera */}
      <Popover.Root
        open={openPanel === "camera"}
        onOpenChange={(open) => onOpenPanelChange(open ? "camera" : null)}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={`Camera, ${cameraSummary}`}
            aria-haspopup="dialog"
            aria-expanded={openPanel === "camera"}
            className={`${PILL} ${openPanel === "camera" ? PILL_OPEN : ""} flex-col !items-start !gap-0 !py-1`}
          >
            <span className="text-[10px] font-medium leading-3 text-white/50">Camera</span>
            <span className="max-w-[110px] truncate text-xs font-semibold leading-4 text-white">
              {cameraSummary}
            </span>
          </button>
        </Popover.Trigger>
        <Popover.Portal container={portalContainer}>
          <Popover.Content
            side="top"
            align="start"
            sideOffset={8}
            className={`${POPOVER_CONTENT} w-[300px]`}
          >
            <PopoverHeader title="Camera" onReset={onResetAll} />
            <InnerTabs
              tabs={[
                { id: "setup", label: "Setup" },
                { id: "movement", label: "Movement" },
              ]}
              value={cameraTab}
              onChange={onCameraTabChange}
            />
            {cameraTab === "setup" ? (
              <div className="flex flex-col gap-1">
                <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  Camera
                </p>
                <OptionGrid
                  options={CINEMA40_CAMERAS}
                  value={settings.camera.camera}
                  onSelect={(camera) => onCameraChange({ camera })}
                />
                <p className="px-3 pt-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  Lens
                </p>
                <OptionGrid
                  options={CINEMA40_LENSES}
                  value={settings.camera.lens}
                  onSelect={(lens) => onCameraChange({ lens })}
                />
              </div>
            ) : (
              <>
                <p className="px-3 pb-1 pt-2 text-[10px] text-white/40">
                  Adds a #tag to the prompt box.
                </p>
                <MovementTagList onAppendMovementTag={onAppendMovementTag} />
              </>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {/* Color palette */}
      <Popover.Root
        open={openPanel === "colorPalette"}
        onOpenChange={(open) => onOpenPanelChange(open ? "colorPalette" : null)}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={`Color palette, ${settings.colorPalette}`}
            aria-haspopup="dialog"
            aria-expanded={openPanel === "colorPalette"}
            className={`${PILL} ${openPanel === "colorPalette" ? PILL_OPEN : ""} flex-col !items-start !gap-0 !py-1`}
          >
            <span className="text-[10px] font-medium leading-3 text-white/50">Color palette</span>
            <span className="max-w-[110px] truncate text-xs font-semibold leading-4 text-white">
              {settings.colorPalette}
            </span>
          </button>
        </Popover.Trigger>
        <Popover.Portal container={portalContainer}>
          <Popover.Content
            side="top"
            align="start"
            sideOffset={8}
            className={`${POPOVER_CONTENT} w-[280px]`}
          >
            <PopoverHeader title="Color palette" onReset={onResetAll} />
            <OptionGrid options={COLOR_PALETTES} value={settings.colorPalette} onSelect={onColorPaletteChange} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {/* Lighting */}
      <Popover.Root
        open={openPanel === "lighting"}
        onOpenChange={(open) => onOpenPanelChange(open ? "lighting" : null)}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={`Lighting, ${settings.lighting}`}
            aria-haspopup="dialog"
            aria-expanded={openPanel === "lighting"}
            className={`${PILL} ${openPanel === "lighting" ? PILL_OPEN : ""} flex-col !items-start !gap-0 !py-1`}
          >
            <span className="text-[10px] font-medium leading-3 text-white/50">Lighting</span>
            <span className="max-w-[110px] truncate text-xs font-semibold leading-4 text-white">
              {settings.lighting}
            </span>
          </button>
        </Popover.Trigger>
        <Popover.Portal container={portalContainer}>
          <Popover.Content
            side="top"
            align="start"
            sideOffset={8}
            className={`${POPOVER_CONTENT} w-[260px]`}
          >
            <PopoverHeader title="Lighting" onReset={onResetAll} />
            <OptionGrid options={LIGHTING} value={settings.lighting} onSelect={onLightingChange} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <Cinema25AssetsPicker
        isOpen={assetsPickerOpen}
        onClose={() => onAssetsPickerOpenChange(false)}
        context="reference"
        onSelectAsset={(url) => {
          if (settings.references.length < MAX_REFERENCES) onAddReference(url);
        }}
        showElementsTab
        initialTab={assetsPickerTab}
      />
    </div>
  );
}
