"use client";

import CommunityCard, { type CommunityItem } from "./CommunityCard";

const POSTERS = [
  "/cinema-studio/lighting/contre-jour.jpg",
  "/cinema-studio/lighting/overhead-fall.jpg",
  "/cinema-studio/lighting/practicals.jpg",
  "/cinema-studio/lighting/silhouette.jpg",
  "/cinema-studio/lighting/soft-cross.jpg",
  "/cinema-studio/lighting/window.jpg",
];

const CLIPS = [
  "/Video/grok-video-0befd331-7fb3-443c-8775-ff049e6dc48a.mp4",
  "/Video/grok-video-50b459b5-00fd-42d5-8ae0-a3809614f9a9.mp4",
  "/Video/grok-video-5be61c79-973a-4199-9f66-6f05f0d293e8.mp4",
  "/Video/grok-video-5f1d7136-8369-40a6-9c5d-c7bd481f8c74.mp4",
  "/Video/grok-video-737bbbd2-edc9-4337-8072-23c22b17b98f.mp4",
  "/Video/grok-video-819d5cf3-9ace-476a-a1ce-062d7051288f.mp4",
  "/Video/grok-video-8b4f6a0d-35b7-4062-9963-3fe20bb25b5a.mp4",
  "/Video/grok-video-bafca2bf-5021-413e-a7c0-e88d28685a1b.mp4",
  "/Video/grok-video-cf4abeca-f4a1-4ef3-a014-8c8961cdb722.mp4",
];

const AVATAR = "/marketing-logo.png";

/** Exactly nine community entries — a fixed local array, no backend call. */
const COMMUNITY_ITEMS: CommunityItem[] = [
  { title: "Neon rooftop chase", creator: "aylin.k", views: "12.4K", likes: "842", team: true },
  { title: "Desert convoy, golden hour", creator: "m.demir", views: "9.1K", likes: "610" },
  { title: "Underwater cathedral", creator: "solveig", views: "24.8K", likes: "1.9K", team: true },
  { title: "Slow dolly through fog", creator: "kaan.v", views: "7.6K", likes: "455" },
  { title: "Portrait, single practical", creator: "nadia_r", views: "18.2K", likes: "1.2K" },
  { title: "Storm over the ridge", creator: "eren.ates", views: "5.3K", likes: "298" },
  { title: "Midnight train window", creator: "lucia.m", views: "31.7K", likes: "2.4K", team: true },
  { title: "Handheld market walk", creator: "t.okur", views: "4.8K", likes: "221" },
  { title: "Silhouette, backlit rain", creator: "juno.p", views: "15.9K", likes: "1.1K" },
].map((entry, i) => ({
  ...entry,
  id: `community-${i + 1}`,
  creatorAvatar: AVATAR,
  poster: POSTERS[i % POSTERS.length],
  hoverVideo: CLIPS[i],
  href: "#",
}));

/**
 * Community grid sitting on solid black directly under the video hero —
 * exactly nine cards, 3/2/1 columns with a 16px gap.
 */
export default function CommunitySection({
  sidebarWidth = 52,
}: {
  /** Current Cinema Generate sidebar width (px) — keeps this grid's left edge
   *  lined up under the independent hero/composer panel above it. */
  sidebarWidth?: number;
}) {
  return (
    <section className="relative z-10 w-full overflow-x-clip bg-transparent">
      {/* Slides with the hero panel above rather than being squeezed: the left
          inset is pinned to the collapsed sidebar and only a transform follows
          the live width, so the grid keeps its columns as the sidebar opens. */}
      <div
        className="mx-auto w-full max-w-[1320px] px-4 py-10 transition-transform duration-300 ease-out md:pl-[60px]"
        style={{ transform: `translateX(${Math.max(0, (sidebarWidth ?? 52) - 52)}px)` }}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {COMMUNITY_ITEMS.map((item) => (
            <CommunityCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}
