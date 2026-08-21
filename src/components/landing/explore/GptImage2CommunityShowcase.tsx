export interface GptImageCard {
  id: string;
  user: string;
  avatar: string;
  likes: number;
  imageSrc: string;
}

export const GPT_IMAGE2_COMMUNITY_CARDS: GptImageCard[] = [
  {
    id: "1",
    user: "cezanne_cupcake_haze12",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 905,
    imageSrc: "/Klon kopya fotos _videos/gpt_image_2_assets/gpt_image_card_1.png",
  },
  {
    id: "2",
    user: "adapting_potato_keen39",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 170,
    imageSrc: "/Klon kopya fotos _videos/gpt_image_2_assets/gpt_image_card_2.png",
  },
  {
    id: "3",
    user: "renaissance_soda_warm52",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 112,
    imageSrc: "/Klon kopya fotos _videos/gpt_image_2_assets/gpt_image_card_3.png",
  },
  {
    id: "4",
    user: "piffle_jack",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 618,
    imageSrc: "/Klon kopya fotos _videos/gpt_image_2_assets/gpt_image_card_4.png",
  },
  {
    id: "5",
    user: "modular_pufferfish_swift82",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 257,
    imageSrc: "/Klon kopya fotos _videos/gpt_image_2_assets/gpt_image_card_5.png",
  },
  {
    id: "6",
    user: "prompt_beetlez",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 651,
    imageSrc: "/Klon kopya fotos _videos/gpt_image_2_assets/gpt_image_card_6.webp",
  },
  {
    id: "7",
    user: "steampunk_donut_jade65",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 228,
    imageSrc: "/Klon kopya fotos _videos/gpt_image_2_assets/gpt_image_card_7.png",
  },
  {
    id: "8",
    user: "gaziziz",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 122,
    imageSrc: "/Klon kopya fotos _videos/gpt_image_2_assets/gpt_image_card_8.png",
  },
  {
    id: "9",
    user: "degas_pancakek",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 51,
    imageSrc: "/Klon kopya fotos _videos/gpt_image_2_assets/gpt_image_card_9.png",
  },
  {
    id: "10",
    user: "folk_rainbow_wise28",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 381,
    imageSrc: "/Klon kopya fotos _videos/gpt_image_2_assets/gpt_image_card_10.png",
  },
  {
    id: "11",
    user: "surreal_pencil_sage24",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 308,
    imageSrc: "/Klon kopya fotos _videos/gpt_image_2_assets/gpt_image_card_11.png",
  },
  {
    id: "12",
    user: "singing_pencillin",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 221,
    imageSrc: "/Klon kopya fotos _videos/gpt_image_2_assets/gpt_image_card_12.png",
  },
  {
    id: "13",
    user: "karimsky_dev",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 140,
    imageSrc: "/Klon kopya fotos _videos/gpt_image_2_assets/gpt_image_card_13.png",
  },
  {
    id: "14",
    user: "steampunk_donut_jade65",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 84,
    imageSrc: "/Klon kopya fotos _videos/gpt_image_2_assets/gpt_image_card_14.png",
  },
  {
    id: "15",
    user: "cezanne_cupcake_haze12",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 905,
    imageSrc: "/Klon kopya fotos _videos/gpt_image_2_assets/gpt_image_card_15.png",
  },
  {
    id: "16",
    user: "adapting_potato_keen39",
    avatar: "/Klon kopya fotos _videos/seedance 2.5/default_avatar.png",
    likes: 170,
    imageSrc: "/Klon kopya fotos _videos/gpt_image_2_assets/gpt_image_card_16.png",
  }
];

export default function GptImage2CommunityShowcase() {
  return (
    <div className="w-full pt-8 pb-4">
      {/* Title & Subtitle Header */}
      <div className="mb-4 flex flex-col items-start gap-1">
        <a
          href="/gpt-image-2-community"
          className="group inline-flex items-center gap-2 font-grotesk text-xl font-bold uppercase text-white transition-colors hover:text-[#D1FE17] md:text-2xl"
        >
          <span>GPT Image 2</span>
        </a>
      </div>

      {/* Grid Container with Bottom Gradient Fade & Floating Button */}
      <div className="relative overflow-hidden rounded-2xl">
        {/* 4 columns x 4 rows grid */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {GPT_IMAGE2_COMMUNITY_CARDS.map((item) => (
            <div
              key={item.id}
              className="group relative overflow-hidden rounded-xl bg-black/80 border border-white/10 transition-all duration-200 hover:border-white/30"
            >
              <figure className="relative aspect-[3/4] w-full overflow-hidden">
                <img
                  loading="lazy"
                  decoding="async"
                  src={item.imageSrc}
                  alt={item.user}
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
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-44 bg-gradient-to-t from-black via-black/80 to-transparent z-10" />

        {/* Floating "View all of GPT Image 2 ↗" Button */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
          <a
            href="/gpt-image-2-community"
            className="inline-flex items-center gap-2 rounded-xl bg-[#D1FE17] px-5 py-2.5 text-xs font-bold text-black shadow-xl transition-transform duration-200 hover:scale-105 active:scale-95"
          >
            <span>View all of GPT Image 2</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M7 17L17 7M17 7H7M17 7V17" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  );
}
