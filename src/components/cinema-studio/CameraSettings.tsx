"use client";

import { ReactNode } from "react";
import { X } from "lucide-react";
import Wheel from "./Wheel";
import {
  cameraColumn,
  lensColumn,
  focalLengthColumn,
  apertureColumn,
  type CameraSettingItem,
} from "./cameraSettingsData";

interface CameraSettingsProps {
  open: boolean;
  onClose: () => void;
  camera?: {
    camera?: string;
    lens?: string;
    focalLength?: number;
    aperture?: string;
  };
  onCameraChange?: (camera: NonNullable<CameraSettingsProps["camera"]>) => void;
  /** Real current Genre/Style summary so the top pills stay in sync
      instead of showing stale hardcoded text. */
  genre?: string;
  styleLabel?: string;
  docked?: boolean;
}

const AutoIconCamera = () => (
  <svg
    className="size-8"
    width="32"
    height="32"
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M2.6665 9.33325C2.6665 7.12411 4.45737 5.33325 6.6665 5.33325H17.3332C19.5423 5.33325 21.3332 7.12411 21.3332 9.33325V11.1756L25.4739 9.1052C27.247 8.21866 29.3332 9.50799 29.3332 11.4903V20.5089C29.3332 22.4913 27.247 23.7806 25.4739 22.8941L21.3332 20.8237V22.6666C21.3332 24.8757 19.5423 26.6666 17.3332 26.6666H6.6665C4.45737 26.6666 2.6665 24.8757 2.6665 22.6666V9.33325ZM21.3332 17.8422L26.6665 20.5089V11.4903L21.3332 14.157V17.8422Z"
      fill="url(#camera-auto-icon-gradient)"
    />
    <defs>
      <linearGradient
        id="camera-auto-icon-gradient"
        x1="16"
        y1="2.66675"
        x2="16"
        y2="29.3334"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="white" />
        <stop offset="1" stopColor="#EDEDED" stopOpacity="0.3" />
      </linearGradient>
    </defs>
  </svg>
);

const AutoIconLens = () => (
  <svg
    className="size-8"
    width="32"
    height="32"
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M16.0003 29.3334C23.3641 29.3334 29.3337 23.3639 29.3337 16.0001C29.3337 8.63628 23.3641 2.66675 16.0003 2.66675C8.63653 2.66675 2.66699 8.63628 2.66699 16.0001C2.66699 23.3639 8.63653 29.3334 16.0003 29.3334ZM16.0003 11.3334C16.7367 11.3334 17.3337 10.7365 17.3337 10.0001C17.3337 9.2637 16.7367 8.66675 16.0003 8.66675C15.2639 8.66675 14.667 9.2637 14.667 10.0001C14.667 10.7365 15.2639 11.3334 16.0003 11.3334ZM22.0003 17.3334C22.7367 17.3334 23.3337 16.7365 23.3337 16.0001C23.3337 15.2637 22.7367 14.6667 22.0003 14.6667C21.2639 14.6667 20.667 15.2637 20.667 16.0001C20.667 16.7365 21.2639 17.3334 22.0003 17.3334ZM11.3337 16.0001C11.3337 16.7365 10.7367 17.3334 10.0003 17.3334C9.26395 17.3334 8.66699 16.7365 8.66699 16.0001C8.66699 15.2637 9.26395 14.6667 10.0003 14.6667C10.7367 14.6667 11.3337 15.2637 11.3337 16.0001ZM16.0003 23.3334C16.7367 23.3334 17.3337 22.7365 17.3337 22.0001C17.3337 21.2637 16.7367 20.6667 16.0003 20.6667C15.2639 20.6667 14.667 21.2637 14.667 22.0001C14.667 22.7365 15.2639 23.3334 16.0003 23.3334ZM12.7005 10.8146C13.2212 11.3353 13.2212 12.1795 12.7005 12.7002C12.1798 13.2209 11.3356 13.2209 10.8149 12.7002C10.2942 12.1795 10.2942 11.3353 10.8149 10.8146C11.3356 10.2939 12.1798 10.2939 12.7005 10.8146ZM21.1858 12.7002C21.7065 12.1795 21.7065 11.3353 21.1858 10.8146C20.6651 10.2939 19.8209 10.2939 19.3002 10.8146C18.7795 11.3353 18.7795 12.1795 19.3002 12.7002C19.8209 13.2209 20.6651 13.2209 21.1858 12.7002ZM12.7005 19.2999C13.2212 19.8206 13.2212 20.6648 12.7005 21.1855C12.1798 21.7062 11.3356 21.7062 10.8149 21.1855C10.2942 20.6648 10.2942 19.8206 10.8149 19.2999C11.3356 18.7792 12.1798 18.7792 12.7005 19.2999ZM21.1858 21.1855C21.7065 20.6648 21.7065 19.8206 21.1858 19.2999C20.6651 18.7792 19.8209 18.7792 19.3002 19.2999C18.7795 19.8206 18.7795 20.6648 19.3002 21.1855C19.8209 21.7062 20.6651 21.7062 21.1858 21.1855Z"
      fill="url(#lens-auto-icon-gradient)"
    />
    <defs>
      <linearGradient
        id="lens-auto-icon-gradient"
        x1="16"
        y1="2.66675"
        x2="16"
        y2="29.3334"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="white" />
        <stop offset="1" stopColor="#EDEDED" stopOpacity="0.3" />
      </linearGradient>
    </defs>
  </svg>
);

const AutoIconFocal = () => (
  <svg
    className="size-8"
    width="32"
    height="32"
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M8 6.66667C7.26362 6.66667 6.66667 7.26362 6.66667 8V10.6667C6.66667 11.403 6.06971 12 5.33333 12C4.59695 12 4 11.403 4 10.6667V8C4 5.79086 5.79086 4 8 4H10.6667C11.403 4 12 4.59695 12 5.33333C12 6.06971 11.403 6.66667 10.6667 6.66667H8Z"
      fill="url(#focal-auto-icon-gradient)"
    />
    <path
      d="M20 5.33333C20 4.59695 20.597 4 21.3333 4H24C26.2091 4 28 5.79086 28 8V10.6667C28 11.403 27.403 12 26.6667 12C25.9303 12 25.3333 11.403 25.3333 10.6667V8C25.3333 7.26362 24.7364 6.66667 24 6.66667H21.3333C20.597 6.66667 20 6.06971 20 5.33333Z"
      fill="url(#focal-auto-icon-gradient)"
    />
    <path
      d="M5.33333 20C6.06971 20 6.66667 20.597 6.66667 21.3333V24C6.66667 24.7364 7.26362 25.3333 8 25.3333H10.6667C11.403 25.3333 12 25.9303 12 26.6667C12 27.403 11.403 28 10.6667 28H8C5.79086 28 4 26.2091 4 24V21.3333C4 20.597 4.59695 20 5.33333 20Z"
      fill="url(#focal-auto-icon-gradient)"
    />
    <path
      d="M26.6667 20C27.403 20 28 20.597 28 21.3333V24C28 26.2091 26.2091 28 24 28H21.3333C20.597 28 20 27.403 20 26.6667C20 25.9303 20.597 25.3333 21.3333 25.3333H24C24.7364 25.3333 25.3333 24.7364 25.3333 24V21.3333C25.3333 20.597 25.9303 20 26.6667 20Z"
      fill="url(#focal-auto-icon-gradient)"
    />
    <path
      d="M16 10.6667C13.0545 10.6667 10.6667 13.0545 10.6667 16C10.6667 18.9455 13.0545 21.3333 16 21.3333C18.9455 21.3333 21.3333 18.9455 21.3333 16C21.3333 13.0545 18.9455 10.6667 16 10.6667Z"
      fill="url(#focal-auto-icon-gradient)"
    />
    <defs>
      <linearGradient
        id="focal-auto-icon-gradient"
        x1="16"
        y1="2.66675"
        x2="16"
        y2="29.3334"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="white" />
        <stop offset="1" stopColor="#EDEDED" stopOpacity="0.3" />
      </linearGradient>
    </defs>
  </svg>
);

const AutoIconAperture = () => (
  <svg
    className="size-8"
    width="32"
    height="32"
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M9.33379 4.97605L5.12012 7.40881C3.88251 8.12335 3.12012 9.44385 3.12012 10.8729V13.1824L9.33379 16.7699V4.97605Z"
      fill="url(#aperture-auto-icon-gradient)"
    />
    <path
      d="M3.12012 16.2616V21.127C3.12012 22.5561 3.88251 23.8766 5.12012 24.5912L7.12029 25.746L13.3339 22.1585L3.12012 16.2616Z"
      fill="url(#aperture-auto-icon-gradient)"
    />
    <path
      d="M9.78696 27.2856L14.0005 29.7182C15.2381 30.4327 16.7629 30.4327 18.0005 29.7182L20.0005 28.5635V21.3888L9.78696 27.2856Z"
      fill="url(#aperture-auto-icon-gradient)"
    />
    <path
      d="M22.6671 27.0239L26.8808 24.5912C28.1184 23.8766 28.8808 22.5561 28.8808 21.127V18.8178L22.6671 15.2303V27.0239Z"
      fill="url(#aperture-auto-icon-gradient)"
    />
    <path
      d="M28.8808 15.7386V10.8729C28.8808 9.44385 28.1184 8.12334 26.8808 7.40881L24.881 6.25421L18.6672 9.84173L28.8808 15.7386Z"
      fill="url(#aperture-auto-icon-gradient)"
    />
    <path
      d="M22.2143 4.71461L18.0005 2.28175C16.7629 1.56722 15.2381 1.56722 14.0005 2.28175L12.0005 3.43645V10.6116L22.2143 4.71461Z"
      fill="url(#aperture-auto-icon-gradient)"
    />
    <path
      d="M16.0005 20.6189L12.0005 18.3095V13.6908L16.0005 11.3813L20.0005 13.6907V18.3096L16.0005 20.6189Z"
      fill="url(#aperture-auto-icon-gradient)"
    />
    <defs>
      <linearGradient
        id="aperture-auto-icon-gradient"
        x1="16"
        y1="2.66675"
        x2="16"
        y2="29.3334"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="white" />
        <stop offset="1" stopColor="#EDEDED" stopOpacity="0.3" />
      </linearGradient>
    </defs>
  </svg>
);

const AUTO_ICONS: Record<string, () => ReactNode> = {
  camera: AutoIconCamera,
  lens: AutoIconLens,
  focal: AutoIconFocal,
  aperture: AutoIconAperture,
};

// Ghost/active fade for the previous/active/next icon states.
// distance 0 = active (always centered), 1 = ghost neighbor, 2+ = faint.
function cameraFade(distance: number) {
  if (distance === 0) return { opacity: 1, scale: 1 };
  if (distance === 1) return { opacity: 0.4, scale: 0.9 };
  return { opacity: 0.15, scale: 0.6 };
}

/**
 * One independent camera setting column (Camera / Lens / Focal Length / Aperture).
 * Owns its own center card, its own Wheel carousel instance, up/down arrow buttons,
 * and its own previous/active/next icon states — no shared overlay across columns.
 */
function SettingColumn({
  title,
  items,
  value,
  onChange,
}: {
  title: string;
  items: CameraSettingItem[];
  value: string;
  onChange: (v: string) => void;
}) {
  const activeIndex = items.findIndex((i) => i.label === value);
  const activeItem = items[activeIndex] ?? items[0];
  const caption = activeItem.type === "text" ? "mm" : activeItem.label;

  const handlePrev = () => {
    const prevIndex = (activeIndex - 1 + items.length) % items.length;
    onChange(items[prevIndex].label);
  };

  const handleNext = () => {
    const nextIndex = (activeIndex + 1) % items.length;
    onChange(items[nextIndex].label);
  };

  return (
    <div className="camera-column relative flex-1 min-w-0 border-l border-white/[0.06] first:border-l-0 flex flex-col">
      {/* Up arrow button — controls ONLY this column */}
      <button
        type="button"
        onClick={handlePrev}
        className="flex h-8 w-8 items-center justify-center mx-auto shrink-0 rounded-full border border-[rgba(197,197,197,0.3)] backdrop-blur-[4px] bg-white/4 hover:bg-white/8 transition-colors cursor-pointer active:scale-95"
        aria-label={`Scroll ${title} up`}
      >
        <svg
          className="size-3.5 text-white rotate-180"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M8 10L11.6464 13.6464C11.8417 13.8417 12.1583 13.8417 12.3536 13.6464L16 10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Local center card — owned by this column only, not a shared overlay */}
      <div
        className="camera-card pointer-events-none absolute left-2 right-2 top-1/2 -translate-y-1/2 rounded-[56px] bg-[rgba(255,255,255,0.04)]"
        style={{ height: 112 }}
        aria-hidden
      />

      {/* Title, pinned above the card, does not move with the carousel */}
      <span
        className="pointer-events-none absolute left-0 right-0 top-1/2 text-center text-caption-s font-bold uppercase text-font-secondary"
        style={{ transform: "translateY(calc(-50% - 92px))" }}
      >
        {title}
      </span>

      <Wheel
        options={items.map((i) => i.label)}
        value={value}
        onChange={onChange}
        fade={cameraFade}
        gapClass="gap-3"
        className="h-full flex-1"
        renderItem={(label, { active }) => {
          const item = items.find((i) => i.label === label) ?? items[0];
          return (
            <div className="camera-icon-carousel flex h-20 w-20 items-center justify-center">
              {item.type === "auto-svg" &&
                (() => {
                  const Icon = AUTO_ICONS[item.svg ?? ""] ?? AutoIconCamera;
                  return (
                    <div className={active ? "text-white" : "text-neutral-400"}>
                      <Icon />
                    </div>
                  );
                })()}
              {item.type === "image" && item.src && (
                <div className="size-20 rounded-lg overflow-hidden shrink-0 relative">
                  <img
                    src={item.src}
                    alt={item.label}
                    className="object-contain size-full brightness-110 contrast-125 saturate-125"
                  />
                </div>
              )}
              {item.type === "text" && (
                <span className="text-3xl font-medium text-font-primary">
                  {item.label}
                </span>
              )}
            </div>
          );
        }}
      />

      {/* Caption, pinned below the card, reflects the real active value */}
      <span
        className="pointer-events-none absolute left-0 right-0 top-1/2 text-center text-xs font-medium text-font-primary truncate px-2"
        style={{ transform: "translateY(calc(-50% + 68px))" }}
      >
        {caption}
      </span>

      {/* Down arrow button — controls ONLY this column */}
      <button
        type="button"
        onClick={handleNext}
        className="flex h-8 w-8 items-center justify-center mx-auto shrink-0 rounded-full border border-[rgba(197,197,197,0.3)] backdrop-blur-[4px] bg-white/4 hover:bg-white/8 transition-colors cursor-pointer active:scale-95"
        aria-label={`Scroll ${title} down`}
      >
        <svg
          className="size-3.5 text-white"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M8 10L11.6464 13.6464C11.8417 13.8417 12.1583 13.8417 12.3536 13.6464L16 10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

export default function CameraSettings({
  open,
  onClose,
  camera,
  onCameraChange,
  genre,
  styleLabel,
  docked = false,
}: CameraSettingsProps) {
  if (!open) return null;

  const cameraValue = camera?.camera ?? "Auto";
  const lensValue = camera?.lens ?? "Auto";
  const focalValue =
    camera?.focalLength != null ? String(camera.focalLength) : "Auto";
  const apertureValue = camera?.aperture ?? "Auto";

  const cameraSummary =
    [camera?.camera, camera?.lens, camera?.aperture].some(
      (v) => v && v !== "Auto",
    ) || (camera?.focalLength != null && camera.focalLength !== 35)
      ? "Custom"
      : "Auto";

  const update = (patch: Partial<NonNullable<CameraSettingsProps["camera"]>>) =>
    onCameraChange?.({ ...camera, ...patch });

  // Extract header pills as separate const JSX component
  const headerPills = (
    <div className="flex shrink-0 justify-center px-8">
      <div
        className="relative flex w-full min-w-0 items-end justify-center overflow-visible pb-1"
        style={{ height: 56 }}
      >
        <div className="flex justify-center w-full min-w-0 max-w-full">
          <div className="flex items-center gap-0.5 p-0.75 rounded-[20px] w-max bg-gradient-to-r from-[#141619] to-[#27292b] overflow-x-auto hide-scrollbar max-w-full">
            <button className="h-8 flex items-center gap-1 pl-1 pr-3 py-1 rounded-[18px] shrink-0 bg-[rgba(255,255,255,0.05)] transition-colors hover:bg-[rgba(255,255,255,0.08)] cursor-pointer">
              <div className="relative size-6 rounded-full overflow-hidden shrink-0 flex items-center justify-center bg-white/10">
                <AutoIconCamera />
              </div>
              <div className="flex min-w-0 items-center gap-1 px-1">
                <span className="text-xs font-medium text-font-secondary whitespace-nowrap shrink-0">Genre:</span>
                <span className="text-xs font-medium text-white truncate max-w-[180px] min-w-0">{genre ?? "General"}</span>
              </div>
            </button>
            <button className="h-8 flex items-center gap-1 pl-1 pr-3 py-1 rounded-[18px] shrink-0 bg-[rgba(255,255,255,0.05)] transition-colors hover:bg-[rgba(255,255,255,0.08)] cursor-pointer">
              <div className="flex items-center justify-center size-6 rounded-full bg-white/10 shrink-0">
                <AutoIconCamera />
              </div>
              <div className="flex min-w-0 items-center gap-1 px-1">
                <span className="text-xs font-medium text-font-secondary whitespace-nowrap shrink-0">Style:</span>
                <span className="text-xs font-medium text-white truncate max-w-[180px] min-w-0">{styleLabel ?? "Auto"}</span>
              </div>
            </button>
            <button className="h-8 flex items-center gap-1 pl-1 pr-3 py-1 rounded-[18px] shrink-0 bg-[rgba(255,255,255,0.08)] cursor-pointer">
              <div className="flex items-center justify-center size-6 rounded-full bg-white/10 shrink-0">
                <AutoIconCamera />
              </div>
              <div className="flex min-w-0 items-center gap-1 px-1">
                <span className="text-xs font-medium text-font-secondary whitespace-nowrap shrink-0">Camera:</span>
                <span className="text-xs font-medium text-white truncate max-w-[180px] min-w-0">{cameraSummary}</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // Extract columns grid as separate const JSX component
  const columnsGrid = (
    <div className="relative overflow-hidden rounded-2xl bg-white/5 min-h-0 flex-1">
      <div className="flex items-stretch h-full">
        <SettingColumn
          title="CAMERA"
          items={cameraColumn}
          value={cameraValue}
          onChange={(v) => update({ camera: v === "Auto" ? undefined : v })}
        />
        <SettingColumn
          title="LENS"
          items={lensColumn}
          value={lensValue}
          onChange={(v) => update({ lens: v === "Auto" ? undefined : v })}
        />
        <SettingColumn
          title="FOCAL LENGTH"
          items={focalLengthColumn}
          value={focalValue}
          onChange={(v) => update({ focalLength: v === "Auto" ? undefined : Number(v) })}
        />
        <SettingColumn
          title="APERTURE"
          items={apertureColumn}
          value={apertureValue}
          onChange={(v) => update({ aperture: v === "Auto" ? undefined : v })}
        />
      </div>
      <div className="absolute top-0 left-0 right-0 h-6 pointer-events-none w-full bg-gradient-to-b from-neutral-primary-reverted-5 to-transparent z-[1]" />
      <div className="absolute bottom-0 left-0 right-0 h-6 pointer-events-none w-full bg-gradient-to-t from-neutral-primary-reverted-5 to-transparent z-[1]" />
    </div>
  );

  // Extract title header as separate const JSX component
  const titleHeader = (
    <div className="flex items-center gap-2 px-3 py-1">
      <span className="flex-1 text-sm font-semibold text-white">Camera Settings</span>
      <button
        type="button"
        onClick={onClose}
        className="flex size-8 items-center justify-center rounded-full bg-surface-primary border border-separator-card/4 hover:bg-white/10 transition-colors cursor-pointer"
      >
        <X className="size-3 text-icon-secondary" />
      </button>
    </div>
  );

  // Return ternary: docked ? <dockedPanel> : <modalPanel>
  if (docked) {
    return (
      <div className="flex h-[27rem] w-full flex-col gap-3 overflow-hidden rounded-[20px] p-1 backdrop-blur-[20px] shadow-[0_12px_8px_0_rgba(0,0,0,0.20),inset_0_0_0_1px_rgba(217,217,217,0.04)] bg-gradient-to-b from-[rgba(21,21,21,0.88)] to-[rgba(21,21,21,0.88)]">
        {headerPills}
        {titleHeader}
        {columnsGrid}
      </div>
    );
  }

  // Modal mode: wrap in backdrop
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center pointer-events-auto">
      {/* Backdrop */}
      <div
        className="absolute inset-0 backdrop-blur-[40px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-[min(876px,calc(100vw-32px))]">
        <div className="flex max-h-full min-h-0 w-full flex-col gap-3 overflow-visible">
          {headerPills}
          {/* Panel body */}
          <div className="camera-panel min-h-0 flex h-[35rem] max-h-[calc(100vh-8rem)] overflow-hidden [&>*]:h-full [&>*]:min-h-0">
            <div className="w-full h-full min-h-0">
              <div className="relative flex flex-col gap-1 overflow-hidden rounded-[20px] p-1 w-full backdrop-blur-[20px] shadow-[0_12px_8px_0_rgba(0,0,0,0.20),inset_0_0_0_1px_rgba(217,217,217,0.04)] h-full min-h-0 bg-gradient-to-b from-[rgba(21,21,21,0.88)] to-[rgba(21,21,21,0.88)]">
                {titleHeader}
                {columnsGrid}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
