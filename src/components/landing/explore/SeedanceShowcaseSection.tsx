export interface ShowcaseVideo {
  id: string;
  user: string;
  avatar: string;
  likes: number;
  videoSrc: string;
  aspect?: string;
}

export const SHOWCASE_VIDEOS: ShowcaseVideo[] = [
  {
    id: "1",
    user: "banksy_pancake_gold22",
    avatar: "https://static.higgsfield.ai/profile/avatar.png",
    likes: 55,
    videoSrc: "https://d8j0ntlcm91z4.cloudfront.net/user_3HrUZEqvogBOowmw1C0BIb3oNDN/hf_20260814_002238_83054aec-92b9-4efe-b015-6c33e4bd7ba3_wm3.mp4"
  },
  {
    id: "2",
    user: "gaziziz",
    avatar: "https://static.higgsfield.ai/profile/avatar.png",
    likes: 46,
    videoSrc: "https://d8j0ntlcm91z4.cloudfront.net/user_3Btsg1RieQOoYK6o6x65C3UYqNH/hf_20260813_235221_7969f2f0-4868-4639-b8f2-85ca915bdd6e_wm3.mp4"
  },
  {
    id: "3",
    user: "arpanetus",
    avatar: "https://static.higgsfield.ai/profile/avatar.png",
    likes: 99,
    videoSrc: "https://d8j0ntlcm91z4.cloudfront.net/user_2urnL94WJ71YKcCUCm8E5tfhGy9/437a80c2-3e11-4650-8777-c06e7ca567c5_hs_wm.mp4"
  },
  {
    id: "4",
    user: "folkemerald1346",
    avatar: "https://static.higgsfield.ai/profile/avatar.png",
    likes: 270,
    videoSrc: "https://d8j0ntlcm91z4.cloudfront.net/user_3CjmrehXCbm5Gx1QXVr3D9qhtaP/b8d9102b-6515-40c2-9ae9-d86f4d8efe4c_hs_wm.mp4"
  },
  {
    id: "5",
    user: "smartbeetle1651",
    avatar: "https://static.higgsfield.ai/profile/avatar.png",
    likes: 93,
    videoSrc: "https://d8j0ntlcm91z4.cloudfront.net/user_3FRnqOjr7P4vUmrsWyEzZbKAqVU/77406d67-d5db-4b1d-81e2-9e0139b39249_hs_wm.mp4"
  },
  {
    id: "6",
    user: "jighit",
    avatar: "https://static.higgsfield.ai/profile/avatar.png",
    likes: 20,
    videoSrc: "https://d8j0ntlcm91z4.cloudfront.net/user_2urRVI1bCfxGUsP28tBUphocCbh/507bc86d-a335-48fb-8732-06695a749350_hs_wm.mp4"
  },
  {
    id: "7",
    user: "higgsfield_hall_of_fame",
    avatar: "https://static.higgsfield.ai/profile/avatar.png",
    likes: 33,
    videoSrc: "https://d8j0ntlcm91z4.cloudfront.net/user_3HrUZEqvogBOowmw1C0BIb3oNDN/hf_20260814_041544_b5f84d9d-a9db-472c-9ece-fed23857b096_wm3.mp4"
  },
  {
    id: "8",
    user: "bourgeois_mean",
    avatar: "https://static.higgsfield.ai/profile/avatar.png",
    likes: 36,
    videoSrc: "https://d8j0ntlcm91z4.cloudfront.net/user_3HrUZEqvogBOowmw1C0BIb3oNDN/hf_20260814_041459_e02ab22b-6d8e-46bd-874e-8090a8f00799_wm3.mp4"
  },
  {
    id: "9",
    user: "jennifer_lopez",
    avatar: "https://static.higgsfield.ai/profile/avatar.png",
    likes: 35,
    videoSrc: "https://d8j0ntlcm91z4.cloudfront.net/user_3HrUZEqvogBOowmw1C0BIb3oNDN/hf_20260814_040632_12ff4cdd-bba8-4a6d-bff5-312d4a2cbb23_wm3.mp4"
  },
  {
    id: "10",
    user: "artificial_penguin",
    avatar: "https://static.higgsfield.ai/profile/avatar.png",
    likes: 17,
    videoSrc: "https://d8j0ntlcm91z4.cloudfront.net/user_3HrUZEqvogBOowmw1C0BIb3oNDN/hf_20260814_040418_e674bc76-e8c5-4099-bd5c-f871a9345cda_wm3.mp4"
  },
  {
    id: "11",
    user: "land_art_pencil",
    avatar: "https://static.higgsfield.ai/profile/avatar.png",
    likes: 99,
    videoSrc: "https://d8j0ntlcm91z4.cloudfront.net/user_3H8EAjd4lvlOfCDCxt4J3ZVPr1c/hf_20260807_105454_a60ef591-46a4-49a2-b01a-607dad928ede_thumbnail.webp"
  },
  {
    id: "12",
    user: "futurist_ice_special",
    avatar: "https://static.higgsfield.ai/profile/avatar.png",
    likes: 86,
    videoSrc: "https://d8j0ntlcm91z4.cloudfront.net/user_3Bu4J9LdRqhDHpwVUmDuiPIuIy0/hf_20260807_115856_816bc5fd-ea64-42ed-9c0c-d70e666a148f_thumbnail.webp"
  }
];

export default function SeedanceShowcaseSection() {
  return (
    <div className="w-full px-4 pt-4 md:px-6">
      <section
        className="relative mx-auto mb-6 w-full overflow-hidden rounded-3xl border border-[#9ce6f3]/20 bg-[#000019] p-4 md:p-8"
        style={{
          boxShadow:
            "inset 0px 0px 206.984px -13.247px rgb(97, 204, 255), inset 0px 0px 59.611px 3.312px rgba(97, 204, 255, 0.38), inset 0px 0px 13.247px 5.796px rgba(97, 204, 255, 0.16)",
        }}
      >
        {/* Top Header Section */}
        <div className="relative z-10 flex flex-col items-center justify-between gap-6 pb-8 pt-4 md:flex-row">
          {/* Left Text */}
          <div className="hidden flex-1 text-center md:block lg:text-left">
            <p className="text-sm font-semibold uppercase leading-tight text-white">
              30 seconds in one take.
              <br />
              <span className="text-white/60">50 references in one pass.</span>
            </p>
          </div>

          {/* Center Title & Badge */}
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="font-grotesk text-sm font-bold uppercase tracking-widest text-[#9ce6f3] md:text-base">
              Exclusive access
            </p>
            <h2 className="font-grotesk text-3xl font-black uppercase text-[#9ce6f3] md:text-5xl">
              Seedance 2.5
            </h2>
            <p className="font-grotesk text-xs font-bold uppercase text-[#9ce6f3] md:text-sm">
              at 1080p
            </p>
            <a
              href="/ai/video?model=seedance_2_5&resolution=1080p"
              className="mt-1 inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-xs font-bold uppercase text-black shadow-lg transition-transform hover:scale-105 active:scale-95"
              style={{
                backgroundImage:
                  "linear-gradient(180deg, rgba(255, 255, 20, 0) 0%, rgb(255, 255, 20) 100%), linear-gradient(90deg, rgb(209, 254, 23) 0%, rgb(209, 254, 23) 100%)",
                boxShadow: "0px -3px 0px 0px #829b19 inset",
              }}
            >
              Explore Seedance 2.5 at 1080p
            </a>
          </div>

          {/* Right Text */}
          <div className="hidden flex-1 text-center md:block lg:text-right">
            <p className="text-sm font-semibold uppercase leading-tight text-white">
              Seedance 2.5: the most controllable
              <br />
              <span className="text-white/60">AI video model on higgsfield.ai</span>
            </p>
          </div>
        </div>

        {/* Video Grid (4 cols on desktop) */}
        <div className="relative z-10 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {SHOWCASE_VIDEOS.map((item) => (
            <div
              key={item.id}
              className="group relative overflow-hidden rounded-xl bg-black/60 border border-white/10 transition-transform duration-200 hover:scale-[1.02]"
            >
              <figure className="relative aspect-video w-full overflow-hidden">
                <video
                  autoPlay
                  loop
                  muted
                  playsInline
                  disablePictureInPicture
                  preload="none"
                  src={item.videoSrc}
                  className="size-full object-cover"
                />

                {/* Hover Gradient Overlay */}
                <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black/80 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

                {/* Top Profile Header */}
                <div className="absolute top-0 z-10 flex w-full items-center justify-between p-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <div className="flex items-center gap-2 truncate">
                    <img
                      src={item.avatar}
                      alt={item.user}
                      className="size-6 rounded-full object-cover border border-white/20"
                    />
                    <span className="truncate text-xs font-medium text-white">{item.user}</span>
                  </div>

                  {/* Likes Count */}
                  <div className="flex items-center gap-1 rounded-full bg-white/15 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-md">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M15.1424 6.625C15.1424 10.5781 9.48962 13.5 8.97575 13.5C8.46188 13.5 2.80908 10.5781 2.80908 6.625C2.80908 3.875 4.52204 2.5 6.23501 2.5C7.94795 2.5 8.97575 3.53125 8.97575 3.53125C8.97575 3.53125 10.0035 2.5 11.7165 2.5C13.4295 2.5 15.1424 3.875 15.1424 6.625Z" />
                    </svg>
                    <span>{item.likes}</span>
                  </div>
                </div>
              </figure>
            </div>
          ))}

          {/* View All Floating Button */}
          <div className="absolute bottom-4 right-4 z-20">
            <a
              href="/ai/video?model=seedance_2_5"
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#D1FE17] px-4 py-2.5 text-xs font-bold text-black shadow-lg transition-transform hover:scale-105 active:scale-95"
            >
              <span>View all of Seedance 2.5</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M7 17L17 7M17 7H7M17 7V17" />
              </svg>
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
