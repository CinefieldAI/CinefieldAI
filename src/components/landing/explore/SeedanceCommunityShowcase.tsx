export interface CommunityVideo {
  id: string;
  user: string;
  avatar: string;
  likes: number;
  videoSrc: string;
  caption?: string;
}

export const SEEDANCE_COMMUNITY_VIDEOS: CommunityVideo[] = [
  {
    id: "1",
    user: "higgsfield_hall_of_fame",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 57,
    videoSrc: "/Klon kopya fotos _videos/seedance 2.5/showcase_card_7_higgsfield_hall_of_fame.mp4"
  },
  {
    id: "2",
    user: "jighit",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 36,
    videoSrc: "/Klon kopya fotos _videos/seedance 2.5/showcase_card_6_jighit.mp4"
  },
  {
    id: "3",
    user: "banksy_pancake_gold22",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 83,
    videoSrc: "/Klon kopya fotos _videos/seedance 2.5/showcase_card_1_banksy_pancake_gold22.mp4"
  },
  {
    id: "4",
    user: "land_art_pencil",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 114,
    videoSrc: "/Klon kopya fotos _videos/seedance 2.5/showcase_card_3_arpanetus.mp4"
  },
  {
    id: "5",
    user: "bourgeois_mean",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 57,
    videoSrc: "/Klon kopya fotos _videos/seedance 2.5/showcase_card_8_bourgeois_mean.mp4"
  },
  {
    id: "6",
    user: "zhanay",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 70,
    videoSrc: "/Klon kopya fotos _videos/seedance 2.5/showcase_card_9_jennifer_lopez.mp4"
  },
  {
    id: "7",
    user: "gaziziz",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 78,
    videoSrc: "/Klon kopya fotos _videos/seedance 2.5/showcase_card_2_gaziziz.mp4"
  },
  {
    id: "8",
    user: "futurist_ice_special",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 102,
    videoSrc: "/Klon kopya fotos _videos/seedance 2.5/showcase_card_5_smartbeetle1651.mp4"
  },
  {
    id: "9",
    user: "artificial_penguin",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 24,
    videoSrc: "/Klon kopya fotos _videos/seedance 2.5/showcase_card_10_artificial_penguin.mp4"
  },
  {
    id: "10",
    user: "folkemerald1346",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 290,
    videoSrc: "/Klon kopya fotos _videos/seedance 2.5/showcase_card_4_folkemerald1346.mp4"
  },
  {
    id: "11",
    user: "smartbeetle1651",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 114,
    videoSrc: "/Klon kopya fotos _videos/seedance 2.5/showcase_card_5_smartbeetle1651.mp4"
  },
  {
    id: "12",
    user: "arpanetus",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 112,
    videoSrc: "/Klon kopya fotos _videos/seedance 2.5/showcase_card_3_arpanetus.mp4"
  }
];

export default function SeedanceCommunityShowcase() {
  return (
    <div className="w-full pt-8 pb-4">
      {/* Title & Subtitle Header */}
      <div className="mb-4 flex flex-col items-start gap-1">
        <a
          href="/seedance-2-5-community"
          className="group inline-flex items-center gap-2 font-grotesk text-xl font-bold uppercase text-white transition-colors hover:text-[#D1FE17] md:text-2xl"
        >
          <span>Seedance 2.5</span>
        </a>
        <p className="text-xs font-medium text-white/50 md:text-sm">
          The most advanced AI video model
        </p>
      </div>

      {/* Grid Container with Bottom Fade & Floating Button */}
      <div className="relative overflow-hidden rounded-2xl">
        {/* 4 columns x 3 rows grid */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {SEEDANCE_COMMUNITY_VIDEOS.map((item) => (
            <div
              key={item.id}
              className="group relative overflow-hidden rounded-xl bg-black/80 border border-white/10 transition-all duration-200 hover:border-white/30"
            >
              <figure className="relative aspect-[16/9] w-full overflow-hidden">
                <video
                  autoPlay
                  loop
                  muted
                  playsInline
                  disablePictureInPicture
                  preload="none"
                  src={item.videoSrc}
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                />

                {/* Dark Hover Overlay */}
                <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black/80 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

                {/* Top Profile Header (Hover State) */}
                <div className="absolute top-0 z-10 flex w-full items-center justify-between p-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <a
                    href={`/@${item.user}`}
                    className="flex items-center gap-2 truncate transition hover:text-[#D1FE17]"
                  >
                    <img
                      src={item.avatar}
                      alt={item.user}
                      className="size-6 rounded-full object-cover border border-white/20"
                    />
                    <span className="truncate text-xs font-medium text-white">{item.user}</span>
                  </a>

                  {/* Likes Pill Button */}
                  <div className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-md border border-white/20">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M15.1424 6.625C15.1424 10.5781 9.48962 13.5 8.97575 13.5C8.46188 13.5 2.80908 10.5781 2.80908 6.625C2.80908 3.875 4.52204 2.5 6.23501 2.5C7.94795 2.5 8.97575 3.53125 8.97575 3.53125C8.97575 3.53125 10.0035 2.5 11.7165 2.5C13.4295 2.5 15.1424 3.875 15.1424 6.625Z" />
                    </svg>
                    <span>{item.likes}</span>
                  </div>
                </div>
              </figure>
            </div>
          ))}
        </div>

        {/* Bottom Gradient Fade-out Effect */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-black via-black/80 to-transparent z-10" />

        {/* Floating "View all of Seedance 2.5 ↗" Button */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
          <a
            href="/seedance-2-5-community"
            className="inline-flex items-center gap-2 rounded-xl bg-[#D1FE17] px-5 py-2.5 text-xs font-bold text-black shadow-xl transition-transform duration-200 hover:scale-105 active:scale-95"
          >
            <span>View all of Seedance 2.5</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M7 17L17 7M17 7H7M17 7V17" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  );
}
