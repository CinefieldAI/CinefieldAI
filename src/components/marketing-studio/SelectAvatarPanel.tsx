"use client";

import { useState, useMemo } from "react";
import { X, Search } from "lucide-react";

type AvatarFilter = "all" | "pinned" | "myAvatars";
type AvatarGender = "male" | "female" | null;

interface SelectAvatarPanelProps {
  isOpen: boolean;
  onClose: () => void;
  avatarFilter: AvatarFilter;
  onAvatarFilterChange: (filter: AvatarFilter) => void;
  avatarGender: AvatarGender;
  onAvatarGenderChange: (gender: AvatarGender) => void;
  avatarSearchQuery: string;
  onAvatarSearchQueryChange: (query: string) => void;
  selectedAvatarId: string | null;
  onAvatarSelect: (avatarId: string) => void;
  promptBarDock?: "top" | "bottom";
}

// Mock avatar data
const MOCK_AVATARS = [
  { id: "avatar-1", name: "Avatar 1", gender: "male", pinned: false },
  { id: "avatar-2", name: "Avatar 2", gender: "female", pinned: true },
  { id: "avatar-3", name: "Avatar 3", gender: "male", pinned: false },
  { id: "avatar-4", name: "Avatar 4", gender: "female", pinned: false },
  { id: "avatar-5", name: "Avatar 5", gender: "male", pinned: true },
];

export default function SelectAvatarPanel({
  isOpen,
  onClose,
  avatarFilter,
  onAvatarFilterChange,
  avatarGender,
  onAvatarGenderChange,
  avatarSearchQuery,
  onAvatarSearchQueryChange,
  selectedAvatarId,
  onAvatarSelect,
  promptBarDock = "bottom",
}: SelectAvatarPanelProps) {
  if (!isOpen) return null;

  const filteredAvatars = useMemo(() => {
    let result = MOCK_AVATARS;

    // Filter by filter type
    if (avatarFilter === "pinned") {
      result = result.filter((a) => a.pinned);
    }
    // "all" and "myAvatars" both show all avatars for now

    // Filter by gender
    if (avatarGender) {
      result = result.filter((a) => a.gender === avatarGender);
    }

    // Filter by search
    if (avatarSearchQuery) {
      result = result.filter((a) =>
        a.name.toLowerCase().includes(avatarSearchQuery.toLowerCase())
      );
    }

    return result;
  }, [avatarFilter, avatarGender, avatarSearchQuery]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[998] bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed z-[999] left-1/2 -translate-x-1/2 w-[min(900px,calc(100vw-32px))] h-[min(560px,calc(100vh-48px))] rounded-2xl border border-white/5 bg-[#0f1b15] text-white shadow-xl overflow-hidden flex flex-row transition-all duration-300 ${
          promptBarDock === "bottom"
            ? "bottom-[160px]"
            : "top-[160px]"
        }`}
        role="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* LEFT SIDEBAR */}
        <aside className="shrink-0 w-[176px] border-r border-white/5 bg-black/20 flex flex-col p-4">
          {/* Close Button (top right) */}
          <div className="flex justify-end mb-4">
            <button
              onClick={onClose}
              className="flex size-6 cursor-pointer items-center justify-center rounded-lg bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Title */}
          <h3 className="text-md font-semibold mb-4">Select Avatar</h3>

          {/* Filter Buttons */}
          <div className="space-y-2 mb-6">
            <button
              onClick={() => onAvatarFilterChange("all")}
              className={`w-full h-8 rounded-lg px-2 text-xs font-medium flex items-center gap-2 transition-colors ${
                avatarFilter === "all"
                  ? "bg-white/10 text-white"
                  : "text-white/70 hover:text-white hover:bg-white/5"
              }`}
            >
              <span>◯</span> All
            </button>
            <button
              onClick={() => onAvatarFilterChange("pinned")}
              className={`w-full h-8 rounded-lg px-2 text-xs font-medium flex items-center gap-2 transition-colors ${
                avatarFilter === "pinned"
                  ? "bg-white/10 text-white"
                  : "text-white/70 hover:text-white hover:bg-white/5"
              }`}
            >
              <span>★</span> Pinned
            </button>
            <button
              onClick={() => onAvatarFilterChange("myAvatars")}
              className={`w-full h-8 rounded-lg px-2 text-xs font-medium flex items-center gap-2 transition-colors ${
                avatarFilter === "myAvatars"
                  ? "bg-white/10 text-white"
                  : "text-white/70 hover:text-white hover:bg-white/5"
              }`}
            >
              <span>👤</span> My avatars
            </button>
          </div>

          {/* Gender Section */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-white/70">Gender</p>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() =>
                  onAvatarGenderChange(avatarGender === "male" ? null : "male")
                }
                className={`h-8 rounded-[10px] text-xs font-medium flex items-center justify-center gap-1 border transition-colors ${
                  avatarGender === "male"
                    ? "bg-white/10 text-white border-white/20"
                    : "border-white/10 text-white/70 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span>♂</span> Male
              </button>
              <button
                onClick={() =>
                  onAvatarGenderChange(avatarGender === "female" ? null : "female")
                }
                className={`h-8 rounded-[10px] text-xs font-medium flex items-center justify-center gap-1 border transition-colors ${
                  avatarGender === "female"
                    ? "bg-white/10 text-white border-white/20"
                    : "border-white/10 text-white/70 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span>♀</span> Female
              </button>
            </div>
          </div>
        </aside>

        {/* RIGHT CONTENT */}
        <div className="flex-1 flex flex-col">
          {/* Search Input */}
          <div className="shrink-0 px-6 py-4 border-b border-white/5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
              <input
                type="text"
                value={avatarSearchQuery}
                onChange={(e) => onAvatarSearchQueryChange(e.target.value)}
                placeholder="Search..."
                className="w-full pl-9 pr-3 py-2 rounded-2xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-white/50 outline-none focus:border-white/20 transition-colors"
              />
            </div>
          </div>

          {/* Avatar Grid */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {filteredAvatars.length > 0 ? (
              <div className="grid grid-cols-3 gap-4">
                {filteredAvatars.map((avatar) => (
                  <button
                    key={avatar.id}
                    onClick={() => onAvatarSelect(avatar.id)}
                    className={`relative rounded-2xl overflow-hidden transition-all ${
                      selectedAvatarId === avatar.id
                        ? "ring-2 ring-cyan-400"
                        : "hover:ring-1 hover:ring-white/50"
                    }`}
                  >
                    {/* Avatar Placeholder */}
                    <div className="w-full aspect-square bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center rounded-2xl">
                      <div className="text-4xl">
                        {avatar.gender === "male" ? "♂" : "♀"}
                      </div>
                    </div>

                    {/* Label */}
                    <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/80 to-transparent">
                      <p className="text-xs font-semibold text-white text-center">
                        {avatar.name}
                      </p>
                    </div>

                    {/* Selection Checkmark */}
                    {selectedAvatarId === avatar.id && (
                      <div className="absolute inset-0 flex items-center justify-center ring-2 ring-cyan-400">
                        <div className="w-6 h-6 rounded-full bg-cyan-400 flex items-center justify-center">
                          <span className="text-black text-sm font-bold">✓</span>
                        </div>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-white/50 text-sm">No avatars found</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
