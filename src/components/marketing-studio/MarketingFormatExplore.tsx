"use client";

import { useState, useRef } from "react";
import { Volume2, VolumeX } from "lucide-react";

export interface ExplorePreset {
  id: string;
  title: string;
  subtitle: string;
  category: "TikTok" | "UGC" | "Commercial";
  isSymphony?: boolean;
  modeIcon: string;
  videos: {
    src: string;
    poster?: string;
  }[];
}

export const EXPLORE_PRESETS: ExplorePreset[] = [
  {
    id: "ugc",
    title: "UGC",
    subtitle: "Realistic social media videos",
    category: "UGC",
    modeIcon:
      "https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=640,quality=85/https://cdn.higgsfield.ai/marketing_studio_video_mode_icon/5945cc0c-f186-4377-bdfd-131b50b59d95.webp",
    videos: [
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/a6573c52-5fd3-4428-aa1f-7443a56916a0-c790a16244fe2bce.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_preset/a81e05e6-5451-4f19-a391-70a0b7f39da5-8fb9d20b85124462.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/9f4320b6-27ce-47dc-be0d-ebc98b232fef-4618b39cd3aedf6a.mp4",
      },
    ],
  },
  {
    id: "gadget-saved-me",
    title: "This Gadget Saved Me",
    subtitle: "Turn product features into a creator-led recommendation",
    category: "TikTok",
    isSymphony: true,
    modeIcon:
      "https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=640,quality=85/https://cdn.higgsfield.ai/marketing_studio_video_mode_icon/227a21f7-ea52-479b-a99d-b6353746da37.webp",
    videos: [
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/a9af9e6c-f2ca-4bc6-8681-bb8e132a0af3-90973eabda978417.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/2c90d936-07e9-4f0e-a0eb-fb7cdbf48228-8b28bde63ae889a5.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/0ffef77f-c1ad-4d98-9847-29afe067b2c3-a739d64f60a6fb5b.mp4",
      },
    ],
  },
  {
    id: "giant-figure",
    title: "Giant Figure",
    subtitle: "Oversized, scroll-stopping product moments",
    category: "UGC",
    modeIcon:
      "https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=640,quality=85/https://cdn.higgsfield.ai/marketing_studio_video_mode_icon/12349a1a-f5fe-46fd-861a-5f398408ef19.webp",
    videos: [
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/c9f0c947-946a-4e15-b124-b7031b432434-983df3ca6a193776.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/6017577c-d9f9-4d1a-87d6-26e96e8e4f25-19ef25a6c2ac8cc9.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/6eaef5bc-d7e0-495d-a64f-f4bd8bf8f6cd-efa7a02a7c17ec9f.mp4",
      },
    ],
  },
  {
    id: "unboxing-virtual-tryon",
    title: "Unboxing Virtual Try-On",
    subtitle: "Unbox and try on in one take",
    category: "TikTok",
    isSymphony: true,
    modeIcon:
      "https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=640,quality=85/https://cdn.higgsfield.ai/marketing_studio_video_mode_icon/8099524e-5cf9-4b58-b4a6-72503b781c5a.webp",
    videos: [
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/5fcbc237-7bfc-4275-8c8c-6c0c80eff401-dcb267808091d553.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/1fccd1d4-d9d5-4cbd-b7fd-76c1d2248922-a2a3d1fe03c105b2.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/28c1ac9d-9b03-4dac-be75-131c3226540a-6924df1fb391d39f.mp4",
      },
    ],
  },
  {
    id: "selfie-testimonial",
    title: "Selfie Testimonial",
    subtitle: "Authentic selfie-style testimonials",
    category: "UGC",
    modeIcon:
      "https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=640,quality=85/https://cdn.higgsfield.ai/marketing_studio_video_mode_icon/1df9a480-dfb8-446b-9762-1bcb1d8564b0.webp",
    videos: [
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/341ee85a-3a25-4816-ba2c-2cdbc56406a7-e07d6ec638ef3375.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/513c91d0-d268-47ac-94d7-a0b6a20a4af3-01675eae1d271215.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/6c05c3b4-7e1c-4538-9e06-d6fb7096dde9-dd64cdbb53253ed2.mp4",
      },
    ],
  },
  {
    id: "classic-meets-modern",
    title: "Classic Meets Modern",
    subtitle: "Blend timeless and contemporary styles",
    category: "Commercial",
    isSymphony: true,
    modeIcon:
      "https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=640,quality=85/https://cdn.higgsfield.ai/marketing_studio_video_mode_icon/1c039553-5c87-418e-9492-bab76870d81a.webp",
    videos: [
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/e407bdfc-6031-496f-bfc2-3528eff1db78-b1a8024a191358fb.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/71d459a3-7025-459b-82fb-8ba29008ba32-1c64ea186d659820.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/1a129f19-4c5c-40f9-9318-a7ebcc9ee531-4cb13abd7396f03f.mp4",
      },
    ],
  },
  {
    id: "unboxing-asmr",
    title: "Unboxing ASMR",
    subtitle: "Satisfying ASMR unboxing experiences",
    category: "UGC",
    modeIcon:
      "https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=640,quality=85/https://cdn.higgsfield.ai/marketing_studio_video_mode_icon/8c28cf90-d1a7-4eb7-888d-aea1a0b3a4b3.webp",
    videos: [
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/eb68f0d4-6a2e-473b-ad39-a34c7e8b1d00-7fd7325a427ac5a7.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/367643d9-3fc5-43ae-aef5-0eeffd18d794-382ee9b9d34ccc3d.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/0eeebf5d-d445-406b-8558-49931d6954a7-bb96f5ba6a13529d.mp4",
      },
    ],
  },
  {
    id: "virtual-tryon-sneakers",
    title: "Virtual Try-On Sneakers",
    subtitle: "Virtual sneaker try-on videos",
    category: "TikTok",
    isSymphony: true,
    modeIcon:
      "https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=640,quality=85/https://cdn.higgsfield.ai/marketing_studio_video_mode_icon/2f79b97e-97b3-4f37-b9e1-2f45964f4580.webp",
    videos: [
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/5afcdf1f-587a-4062-8476-e791b5117f9b-a94d63838639490d.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/8ed3bce7-94b5-4a00-bea5-7139e34cf014-bb64d10c97a4e13b.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/fd5c91da-3622-4451-8c91-cc75337f9924-a340423e6246f392.mp4",
      },
    ],
  },
  {
    id: "camera-pov",
    title: "Camera POV",
    subtitle: "Immersive point-of-view product moments",
    category: "UGC",
    modeIcon:
      "https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=640,quality=85/https://cdn.higgsfield.ai/marketing_studio_video_mode_icon/52812025-86ea-4c1a-b57d-3f5b565d08ed.webp",
    videos: [
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/7a567942-d3ba-40eb-aefd-f35234822e1d-6e434c55fc168de3.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/673f69ef-ce17-4d6b-8ab1-013227ebd4f8-f93a31197c149814.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/17dd9ae4-3af9-486a-8135-4f1658f4e804-11e0ebcd31a00379.mp4",
      },
    ],
  },
  {
    id: "couple-sharing-home",
    title: "Couple Sharing At Home",
    subtitle: "A couple sharing the product at home",
    category: "Commercial",
    modeIcon:
      "https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=640,quality=85/https://cdn.higgsfield.ai/marketing_studio_video_mode_icon/5cee1ea6-1df4-4093-ad28-fc3ad67b9384.webp",
    videos: [
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/cace73e2-f7d9-4d29-b3bc-ddd79bb82358-f55461be871c9dbd.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/d6075b7d-9c43-4d90-a8b4-3a83a7773301-b26a420fef45a9be.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/f819af0c-4af3-4aac-9435-c1049f1c76ae-62cadd6f8e99c5dd.mp4",
      },
    ],
  },
  {
    id: "secret-hack-reveal",
    title: "Secret Hack Reveal",
    subtitle: "Reveal a clever product hack",
    category: "TikTok",
    isSymphony: true,
    modeIcon:
      "https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=640,quality=85/https://cdn.higgsfield.ai/marketing_studio_video_mode_icon/117bc23d-d7f0-4ecd-8235-45fdc6ac80ea.webp",
    videos: [
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/809b9092-e515-49a0-802f-294a60375676-fbf4cac8830fbe0a.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/eb68f0d4-6a2e-473b-ad39-a34c7e8b1d00-7fd7325a427ac5a7.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/367643d9-3fc5-43ae-aef5-0eeffd18d794-382ee9b9d34ccc3d.mp4",
      },
    ],
  },
  {
    id: "mess-to-fresh",
    title: "Mess to Fresh",
    subtitle: "From messy to fresh transformation",
    category: "UGC",
    modeIcon:
      "https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=640,quality=85/https://cdn.higgsfield.ai/marketing_studio_video_mode_icon/25901b29-7101-470a-a24c-fed3655493ff.webp",
    videos: [
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/5fcbc237-7bfc-4275-8c8c-6c0c80eff401-dcb267808091d553.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/1fccd1d4-d9d5-4cbd-b7fd-76c1d2248922-a2a3d1fe03c105b2.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/28c1ac9d-9b03-4dac-be75-131c3226540a-6924df1fb391d39f.mp4",
      },
    ],
  },
  {
    id: "crush-test",
    title: "Crush Test",
    subtitle: "Satisfying crush and durability tests",
    category: "TikTok",
    isSymphony: true,
    modeIcon:
      "https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=640,quality=85/https://cdn.higgsfield.ai/marketing_studio_video_mode_icon/6eac1956-26db-4c81-9ed7-449bd0a2b018.webp",
    videos: [
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/02af8f7c-40cc-4dd5-ad32-7386a2e05e9b-0a3a8105eec7de9c.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/3aa69d22-768c-4949-b96c-998d97265f4d-0612a64a1c32c71f.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/e87d31bd-d3de-4322-ba5a-f17e05dfdcf5-ef365fcd15a53f64.mp4",
      },
    ],
  },
  {
    id: "hyper-motion",
    title: "Hyper Motion",
    subtitle: "High-energy product motion bursts",
    category: "Commercial",
    modeIcon:
      "https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=640,quality=85/https://cdn.higgsfield.ai/marketing_studio_video_mode_icon/0ff32caf-a417-4d4d-9d06-638a8d05bb2a.webp",
    videos: [
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/5af01b17-c727-4755-9f92-10da87d1c71c-30114dc516dca6ea.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/6c05c3b4-7e1c-4538-9e06-d6fb7096dde9-dd64cdbb53253ed2.mp4",
      },
      {
        src: "https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/17dd9ae4-3af9-486a-8135-4f1658f4e804-11e0ebcd31a00379.mp4",
      },
    ],
  },
];

interface MarketingFormatExploreProps {
  onSelectPreset?: (preset: ExplorePreset) => void;
}

export default function MarketingFormatExplore({ onSelectPreset }: MarketingFormatExploreProps) {
  const [activeTab, setActiveTab] = useState<"All" | "TikTok" | "UGC" | "Commercial">("All");
  const [unmutedMap, setUnmutedMap] = useState<Record<string, boolean>>({});

  const toggleMute = (videoKey: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setUnmutedMap((prev) => ({ ...prev, [videoKey]: !prev[videoKey] }));
  };

  const filteredPresets = EXPLORE_PRESETS.filter((item) => {
    if (activeTab === "All") return true;
    return item.category === activeTab;
  });

  return (
    <section className="mx-auto flex w-full max-w-[75rem] flex-col items-center gap-5 md:px-8 md:pb-20 md:pt-5 select-none">
      {/* CATEGORY TABS */}
      <div
        role="tablist"
        aria-label="Explore format categories"
        className="flex max-w-full items-center gap-2 overflow-x-auto p-1 no-scrollbar"
      >
        {/* ALL TAB */}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "All"}
          onClick={() => setActiveTab("All")}
          className={`relative flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-medium leading-4 transition-all ${
            activeTab === "All"
              ? "bg-white text-black font-semibold shadow-md"
              : "bg-white/5 text-white/80 shadow-[0_2px_2px_rgba(0,0,0,0.12),inset_0_2px_3px_rgba(255,255,255,0.05)] backdrop-blur-xl hover:bg-white/10"
          }`}
        >
          <span className="whitespace-nowrap">All</span>
        </button>

        {/* TIKTOK TAB */}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "TikTok"}
          onClick={() => setActiveTab("TikTok")}
          className={`relative flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-xl pl-3 pr-4 text-xs font-medium leading-4 transition-all ${
            activeTab === "TikTok"
              ? "bg-white text-black font-semibold shadow-md"
              : "bg-white/5 text-white/80 shadow-[0_2px_2px_rgba(0,0,0,0.12),inset_0_2px_3px_rgba(255,255,255,0.05)] backdrop-blur-xl hover:bg-white/10"
          }`}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            aria-hidden="true"
            className={`size-3.5 shrink-0 ${activeTab === "TikTok" ? "text-black" : "text-white/45"}`}
          >
            <path
              d="M17.2618 8.51118C15.7788 8.51118 14.4057 8.03996 13.2845 7.23914V13.0605C13.2845 15.9726 10.9226 18.3333 8.00903 18.3333C6.92195 18.3333 5.91156 18.0048 5.07222 17.4415C3.66193 16.495 2.7334 14.8858 2.7334 13.0605C2.7334 10.1486 5.09536 7.78785 8.00912 7.78791C8.25126 7.78779 8.4931 7.80423 8.73298 7.837V8.48335L8.73284 10.7533C8.50196 10.6801 8.25582 10.6404 8.00045 10.6404C6.6676 10.6404 5.58731 11.7203 5.58731 13.0522C5.58731 13.994 6.12731 14.8095 6.91475 15.2067C7.24125 15.3714 7.60999 15.4641 8.00048 15.4641C9.33059 15.4641 10.409 14.3886 10.4136 13.0605V1.66666H13.2844V2.03356C13.2945 2.14326 13.3091 2.25253 13.3281 2.36109C13.5274 3.49697 14.2069 4.46744 15.1501 5.0557C15.7835 5.45085 16.5153 5.65974 17.2618 5.65861L17.2618 8.51118Z"
              fill="currentColor"
            />
          </svg>
          <span className="whitespace-nowrap">TikTok</span>
          <span className="flex h-[15px] items-center rounded-[2px] bg-[#d97757] px-1.5 font-sans text-[10px] font-bold uppercase leading-none text-black -skew-x-[10deg]">
            <span className="skew-x-[10deg]">New</span>
          </span>
        </button>

        {/* UGC TAB */}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "UGC"}
          onClick={() => setActiveTab("UGC")}
          className={`relative flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-xl pl-3 pr-4 text-xs font-medium leading-4 transition-all ${
            activeTab === "UGC"
              ? "bg-white text-black font-semibold shadow-md"
              : "bg-white/5 text-white/80 shadow-[0_2px_2px_rgba(0,0,0,0.12),inset_0_2px_3px_rgba(255,255,255,0.05)] backdrop-blur-xl hover:bg-white/10"
          }`}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className={`size-3.5 shrink-0 ${activeTab === "UGC" ? "text-black" : "text-white/45"}`}
          >
            <path
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M5.75 6.75v-1a3 3 0 0 1 3-3h6.5a3 3 0 0 1 3 3v1m-12.5 0h12.5m-12.5 0v4h-1.5v3h1.5v7.5m12.5-14.5v9.5a3 3 0 0 1-3 3h-4v2m7-14.5h3M10.719 9.944h.01m4.115 0h.01m-.604 5.306c-1.75.25-3.52 0-4.25-1.25"
            />
          </svg>
          <span className="whitespace-nowrap">UGC</span>
        </button>

        {/* COMMERCIAL TAB */}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "Commercial"}
          onClick={() => setActiveTab("Commercial")}
          className={`relative flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-xl pl-3 pr-4 text-xs font-medium leading-4 transition-all ${
            activeTab === "Commercial"
              ? "bg-white text-black font-semibold shadow-md"
              : "bg-white/5 text-white/80 shadow-[0_2px_2px_rgba(0,0,0,0.12),inset_0_2px_3px_rgba(255,255,255,0.05)] backdrop-blur-xl hover:bg-white/10"
          }`}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className={`size-3.5 shrink-0 ${activeTab === "Commercial" ? "text-black" : "text-white/45"}`}
          >
            <path
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M12 7.375V6.347m0 10.278v1.028m2.226-8.736C13.78 8.302 12.95 7.889 12 7.889h-.286c-1.26 0-2.283.818-2.283 1.827v.078c0 .722.51 1.382 1.316 1.705l2.506 1.002c.807.323 1.316.983 1.316 1.705 0 1.052-1.066 1.905-2.382 1.905H12c-.951 0-1.781-.413-2.226-1.028M21.25 12a9.25 9.25 0 1 1-18.5 0 9.25 9.25 0 0 1 18.5 0"
            />
          </svg>
          <span className="whitespace-nowrap">Commercial</span>
        </button>
      </div>

      {/* EXPLORE GRID CARDS */}
      <div className="grid w-full grid-cols-1 gap-5 lg:grid-cols-2">
        {filteredPresets.map((preset) => (
          <article
            key={preset.id}
            onClick={() => onSelectPreset?.(preset)}
            className="relative isolate flex min-w-0 cursor-pointer flex-col gap-2 overflow-hidden rounded-3xl bg-[#141718] p-2 shadow-[0_2px_6px_rgba(0,0,0,0.15),inset_0_-4px_16px_rgba(255,255,255,0.04)] border border-white/5 md:shadow-md transition-transform duration-200 hover:border-white/15"
          >
            {/* SYMPHONY BADGE IF APPLICABLE */}
            {preset.isSymphony && (
              <div className="flex h-6 items-center gap-2 px-2 py-1 text-white">
                <span className="flex items-center gap-1 text-xs font-semibold">
                  <svg width="20" height="20" viewBox="0 0 20 20" className="size-3.5">
                    <path
                      d="M17.2618 8.51118C15.7788 8.51118 14.4057 8.03996 13.2845 7.23914V13.0605C13.2845 15.9726 10.9226 18.3333 8.00903 18.3333C6.92195 18.3333 5.91156 18.0048 5.07222 17.4415C3.66193 16.495 2.7334 14.8858 2.7334 13.0605C2.7334 10.1486 5.09536 7.78785 8.00912 7.78791C8.25126 7.78779 8.4931 7.80423 8.73298 7.837V8.48335L8.73284 10.7533C8.50196 10.6801 8.25582 10.6404 8.00045 10.6404C6.6676 10.6404 5.58731 11.7203 5.58731 13.0522C5.58731 13.994 6.12731 14.8095 6.91475 15.2067C7.24125 15.3714 7.60999 15.4641 8.00048 15.4641C9.33059 15.4641 10.409 14.3886 10.4136 13.0605V1.66666H13.2844V2.03356C13.2945 2.14326 13.3091 2.25253 13.3281 2.36109C13.5274 3.49697 14.2069 4.46744 15.1501 5.0557C15.7835 5.45085 16.5153 5.65974 17.2618 5.65861L17.2618 8.51118Z"
                      fill="currentColor"
                    />
                  </svg>
                  Symphony
                </span>
                <span aria-hidden="true" className="h-4 w-px rotate-[15deg] rounded-full bg-white/20" />
                <span className="flex items-center gap-1 font-sans text-xs font-bold text-white/90">
                  <svg width="16" height="16" viewBox="0 0 16 16" className="size-3.5">
                    <path
                      d="M13.5138 7.89576L13.5033 7.78086C13.4037 6.67806 12.686 4.60327 10.6953 4.60327C9.21806 4.60327 8.10212 6.06142 7.11729 7.34699C6.33143 8.37652 5.65054 9.25969 4.90133 9.25969C4.7022 9.23886 4.44555 9.13953 4.28847 8.91481C4.147 8.71091 4.11036 8.44963 4.18365 8.13607C4.29883 7.63958 4.95899 7.17965 5.65565 6.6884C6.03799 6.42712 6.43099 6.15011 6.70341 5.88359C7.48926 5.12582 7.88737 4.57705 7.88737 3.69389C7.88737 2.81072 7.40021 2.37162 6.99159 2.18345C6.17435 1.80726 4.97476 2.02674 4.20993 2.68533C4.09474 2.7899 3.97941 2.88908 3.87459 2.98316C3.1045 3.66782 2.58595 4.133 1.39673 3.77748V5.20942C2.97355 5.90457 4.29898 4.57705 4.80191 3.96565C5.18951 3.56325 5.59813 3.32804 5.90208 3.32804H5.91785C6.05406 3.33328 6.16924 3.38557 6.25319 3.47965C6.38939 3.63651 6.44181 3.81943 6.41552 4.02318C6.35786 4.4518 5.91259 4.95339 5.09535 5.50216C4.13664 6.14502 2.53369 7.2216 2.40785 8.57518C2.31354 9.54733 2.81647 10.5193 3.60233 10.8955C5.43579 11.7631 6.55173 10.2684 7.73555 8.69009C8.64185 7.47239 9.50099 6.31746 10.6955 6.31746C11.7694 6.31746 12.1675 7.20586 12.1675 7.76513V7.87494L12.0626 7.89576C9.45909 8.3557 8.03935 10.7911 8.03935 11.9147C8.03935 13.0383 8.9928 14 10.1663 14C11.5388 14 13.2361 12.8293 13.5085 9.53685L13.519 9.41669H14.6034V7.89592H13.5138V7.89576ZM12.094 9.58374C11.8845 11.554 10.8734 12.4738 10.2606 12.4738C9.98289 12.4738 9.5953 12.2439 9.5953 11.8154C9.5953 11.3346 10.313 9.87648 11.9264 9.44276L12.1151 9.39572L12.094 9.58389V9.58374Z"
                      fill="currentColor"
                    />
                  </svg>
                  Higgsfield
                </span>
              </div>
            )}

            {/* 3-VIDEO GRID PREVIEW */}
            <div
              className={`relative z-0 grid min-h-0 grid-cols-3 gap-1.5 overflow-hidden ${
                preset.isSymphony ? "h-[188.4px] md:h-[17.5rem]" : "h-[212.4px] md:h-[19.5rem]"
              }`}
            >
              {preset.videos.map((vid, idx) => {
                const videoKey = `${preset.id}-${idx}`;
                const isUnmuted = !!unmutedMap[videoKey];
                const cornerClass =
                  idx === 0
                    ? "rounded-l-2xl rounded-r-md"
                    : idx === 1
                    ? "rounded-md"
                    : "rounded-l-md rounded-r-2xl";

                return (
                  <figure
                    key={videoKey}
                    data-explore-format-preview="true"
                    className={`group relative h-full min-h-0 min-w-0 overflow-hidden border border-white/5 bg-[#1d2123] ${cornerClass}`}
                  >
                    <div className="absolute inset-0 overflow-hidden rounded-[inherit] transition-transform duration-300 ease-out group-hover:scale-105 group-focus-within:scale-105">
                      <video
                        loop
                        muted={!isUnmuted}
                        playsInline
                        disablePictureInPicture
                        preload="metadata"
                        autoPlay
                        src={vid.src}
                        className="object-cover size-full rounded-[inherit]"
                      />
                    </div>

                    <div className="pointer-events-none absolute inset-0 bg-black/10 opacity-0 transition-opacity duration-150 ease group-hover:opacity-100 group-focus-within:opacity-100" />

                    {/* UNMUTE BUTTON */}
                    <button
                      type="button"
                      aria-label="Unmute preview"
                      onClick={(e) => toggleMute(videoKey, e)}
                      className="absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur-sm transition-opacity duration-150 ease hover:bg-black/60 group-hover:opacity-100 group-focus-within:opacity-100"
                    >
                      {isUnmuted ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                    </button>

                    {/* RECREATE HOVER BUTTON */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectPreset?.(preset);
                      }}
                      className="absolute inset-x-3 bottom-3 z-10 flex h-10 items-center justify-center rounded-xl bg-white text-black font-semibold px-4 text-sm shadow-md transition-all duration-150 ease active:scale-[0.98] translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
                    >
                      Recreate
                    </button>
                  </figure>
                );
              })}
            </div>

            {/* BOTTOM INFO ROW */}
            <div className="relative z-10 flex min-w-0 items-center gap-3 bg-[#141718] px-2 py-1">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]"
                aria-label={`Open ${preset.title} details`}
              >
                <figure className="relative size-10 shrink-0 overflow-hidden rounded-[10px] border border-white/10 shadow-[inset_0_2px_4px_rgba(255,255,255,0.1)] md:rounded-xl md:border-0 md:shadow-none">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={preset.title}
                    loading="lazy"
                    decoding="async"
                    className="object-cover size-full"
                    src={preset.modeIcon}
                  />
                </figure>

                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-white md:text-base">
                    {preset.title}
                  </h3>
                  <p className="truncate text-xs text-white/50">{preset.subtitle}</p>
                </div>
              </button>

              {/* TRY BUTTON */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectPreset?.(preset);
                }}
                className="flex h-6 shrink-0 items-center justify-center rounded-md bg-[#d97757] px-3 text-xs font-semibold text-black shadow-[inset_-4px_-4px_13.8px_rgba(255,255,255,0.3),inset_0_4px_4px_rgba(255,255,255,0.25)] transition-all duration-150 ease-out hover:brightness-110 active:scale-[0.98] md:h-8 md:rounded-lg md:px-4 md:text-sm md:shadow-none"
              >
                Try
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
