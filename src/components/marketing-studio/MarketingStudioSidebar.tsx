"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface MarketingStudioSidebarProps {
  activeSidebarView: "home" | "allGenerations" | "favorites";
  onViewChange: (view: "home" | "allGenerations" | "favorites") => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function MarketingStudioSidebar({
  activeSidebarView,
  onViewChange,
  isCollapsed = false,
  onToggleCollapse,
}: MarketingStudioSidebarProps) {
  const [isSpaceDropdownOpen, setIsSpaceDropdownOpen] = useState(false);
  const [isProjectsOpen, setIsProjectsOpen] = useState(true);

  return (
    <>
      {/* COLLAPSE / EXPAND TOGGLE BUTTON (Icon Only with Glowing White Breathing Effect) */}
      <button
        type="button"
        onClick={onToggleCollapse}
        className={cn(
          "fixed top-[70px] z-[100] pointer-events-auto flex size-7 shrink-0 items-center justify-center text-white transition-all duration-300 ease-out cursor-pointer p-0 bg-transparent border-0 group",
          isCollapsed ? "left-4" : "left-[212px]"
        )}
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <style jsx>{`
          @keyframes iconBreathingGlow {
            0%, 100% {
              filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.4));
              opacity: 0.65;
              transform: scale(1);
            }
            50% {
              filter: drop-shadow(0 0 10px rgba(255, 255, 255, 1)) drop-shadow(0 0 18px rgba(255, 255, 255, 0.8));
              opacity: 1;
              transform: scale(1.08);
            }
          }
          .animate-breathing-glow {
            animation: iconBreathingGlow 2.4s ease-in-out infinite;
          }
        `}</style>
        <svg
          className="size-4 text-white animate-breathing-glow group-hover:scale-110 transition-transform"
          aria-hidden="true"
          width="24px"
          height="24px"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M9 5.5V18.5H20.25C20.3881 18.5 20.5 18.3881 20.5 18.25V5.75C20.5 5.61193 20.3881 5.5 20.25 5.5H9ZM2 5.75C2 4.7835 2.7835 4 3.75 4H20.25C21.2165 4 22 4.7835 22 5.75V18.25C22 19.2165 21.2165 20 20.25 20H3.75C2.7835 20 2 19.2165 2 18.25V5.75Z"
            fill="currentColor"
          />
        </svg>
      </button>

      {/* SIDEBAR PANEL */}
      <div
        className={cn(
          "fixed left-0 top-14 z-40 hidden h-[calc(100dvh-3.5rem)] md:block transition-transform duration-300 ease-out border-r border-white/[0.04] bg-[#0d0f10]/95 backdrop-blur-xl",
          isCollapsed ? "-translate-x-full" : "translate-x-0"
        )}
        style={{ width: "199px" }}
      >
        <div className="relative z-30 h-full min-h-0 shrink-0 group/sidebar w-[199px]">
          <div className="h-full flex flex-col overflow-hidden">
            {/* SPACE SWITCHER HEADER */}
            <div className="shrink-0 flex flex-col px-1 pt-3">
              <div className="flex items-start px-1.5">
                <div className="min-w-0 flex-1">
                  <div className="w-full">
                    {/* SPACE SWITCHER CONTAINER CARD */}
                    <div className="flex flex-col rounded-[16px] border border-white/[0.08] bg-[#181818] p-1 shadow-[0_4px_16px_rgba(0,0,0,0.4)] transition-all duration-200">
                      {/* TOP ROW: CURRENT SPACE */}
                      <button
                        type="button"
                        onClick={() => setIsSpaceDropdownOpen(!isSpaceDropdownOpen)}
                        aria-expanded={isSpaceDropdownOpen}
                        className="flex h-9 w-full items-center justify-between gap-1 rounded-xl px-2.5 transition-colors duration-150 hover:bg-white/5 cursor-pointer"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <img
                            src="/cinefield-logo.png"
                            alt="Marketing Studio"
                            className="size-5 rounded-md object-cover shrink-0"
                          />
                          <span className="truncate text-xs font-semibold text-white/90">
                            Marketing Studio
                          </span>
                        </div>
                        <svg
                          className={cn("size-4 shrink-0 text-white/50 transition-transform duration-150", isSpaceDropdownOpen && "rotate-180")}
                          aria-hidden="true"
                          width="24px"
                          height="24px"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M8 8.99989L11.4697 5.53022C11.7626 5.23732 12.2374 5.23732 12.5303 5.53022L16 8.99989M16 14.9999L12.5303 18.4696C12.2374 18.7625 11.7626 18.7625 11.4697 18.4696L8 14.9999"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>

                      {/* DROPDOWN MENU ITEMS */}
                      <AnimatePresence initial={false}>
                        {isSpaceDropdownOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                            className="overflow-hidden flex flex-col gap-0.5 pt-0.5"
                          >
                            {/* CINEFIELD AI — routes to the site home page. It
                                was previously a button with no onClick, so
                                clicking it did nothing. */}
                            <Link
                              href="/"
                              className="group flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-[#8E8E8E] hover:text-white transition-colors duration-150 hover:bg-white/5 cursor-pointer"
                            >
                              <img
                                src="/cinefield-icon-exact.png"
                                alt="Cinefield AI"
                                className="size-[22px] shrink-0 object-contain opacity-75 group-hover:opacity-100 transition-opacity duration-150"
                                style={{
                                  filter: "brightness(0.9) contrast(1.1)",
                                }}
                              />
                              <span
                                className="truncate text-[15px] font-medium leading-none tracking-[-0.015em] text-[#8E8E8E] group-hover:text-white transition-colors duration-150"
                                style={{ transform: "translateY(-0.5px)" }}
                              >
                                Cinefield AI
                              </span>
                            </Link>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>
              </div>

              {/* NAV LINKS */}
              <div className="mt-2 px-0.5">
                <div className="flex flex-col gap-px px-1.5">
                  {/* HOME BUTTON */}
                  <button
                    type="button"
                    onClick={() => onViewChange("home")}
                    className={cn(
                      "group flex items-center gap-2 h-9 px-1.5 rounded-xl transition-colors duration-150 overflow-hidden text-left",
                      activeSidebarView === "home" ? "bg-white/10 text-white" : "hover:bg-white/5 text-white/70"
                    )}
                  >
                    <span aria-hidden="true" className="relative block size-7 shrink-0 overflow-visible">
                      <span className="absolute left-0.5 top-0.5 size-6 overflow-hidden rounded-lg shadow-[0_4px_4px_0_rgba(0,0,0,0.08),inset_0_2px_4px_0_rgba(255,255,255,0.24)] bg-[linear-gradient(135deg,#3E403D_3.87%,#151615_93.45%)]" />
                      <span className="pointer-events-none absolute left-0.5 top-0.5 size-6 rounded-lg bg-[linear-gradient(0deg,rgba(0,0,0,0)_0%,rgba(255,255,255,1)_100%)] opacity-20 mix-blend-overlay" />
                      <span className="pointer-events-none absolute left-0.5 top-0.5 size-6 rounded-lg bg-[linear-gradient(0deg,rgba(0,0,0,0)_0%,rgba(255,255,255,1)_100%)] opacity-32 mix-blend-hard-light" />
                      <span className="pointer-events-none absolute left-0.5 top-0.5 size-6 rounded-lg border border-[rgba(197,197,197,0.24)]" />
                      <span className="absolute left-[7px] top-[7px] flex size-3.5 items-center justify-center text-white">
                        <svg aria-hidden="true" width="24px" height="24px" viewBox="0 0 24 24" fill="none">
                          <path d="M3.75 9.2582C3.75 8.97962 3.75 8.84033 3.78504 8.71146C3.81609 8.59729 3.86716 8.48953 3.93586 8.39321C4.0134 8.28448 4.12121 8.19628 4.33682 8.01987L10.9868 2.57896C11.3478 2.28362 11.5283 2.13596 11.7291 2.07944C11.9063 2.02959 12.0937 2.02959 12.2709 2.07944C12.4717 2.13596 12.6522 2.28362 13.0132 2.57896L19.6632 8.01987C19.8788 8.19628 19.9866 8.28448 20.0641 8.39321C20.1328 8.48953 20.1839 8.59729 20.215 8.71146C20.25 8.84033 20.25 8.97962 20.25 9.2582V18.65C20.25 19.21 20.25 19.4901 20.141 19.704C20.0451 19.8921 19.8922 20.0451 19.704 20.141C19.4901 20.25 19.2101 20.25 18.65 20.25H5.35C4.78995 20.25 4.50992 20.25 4.29601 20.141C4.10785 20.0451 3.95487 19.8921 3.85899 19.704C3.75 19.4901 3.75 19.21 3.75 18.65V9.2582Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </span>
                    <span className="text-xs font-semibold whitespace-nowrap">Home</span>
                  </button>

                  {/* ALL GENERATIONS */}
                  <button
                    type="button"
                    onClick={() => onViewChange("allGenerations")}
                    className={cn(
                      "group flex items-center gap-2 h-9 px-1.5 rounded-xl transition-colors duration-150 overflow-hidden text-left",
                      activeSidebarView === "allGenerations" ? "bg-white/10 text-white" : "hover:bg-white/5 text-white/70"
                    )}
                  >
                    <span aria-hidden="true" className="relative block size-7 shrink-0 overflow-visible">
                      <span className="absolute left-0.5 top-0.5 size-6 overflow-hidden rounded-lg shadow-[0_4px_4px_0_rgba(0,0,0,0.08),inset_0_2px_4px_0_rgba(255,255,255,0.24)] bg-[linear-gradient(135deg,#E251B4_3.87%,#8D1237_93.45%)]" />
                      <span className="pointer-events-none absolute left-0.5 top-0.5 size-6 rounded-lg bg-[linear-gradient(0deg,rgba(0,0,0,0)_0%,rgba(255,255,255,1)_100%)] opacity-20 mix-blend-overlay" />
                      <span className="pointer-events-none absolute left-0.5 top-0.5 size-6 rounded-lg bg-[linear-gradient(0deg,rgba(0,0,0,0)_0%,rgba(255,255,255,1)_100%)] opacity-32 mix-blend-hard-light" />
                      <span className="pointer-events-none absolute left-0.5 top-0.5 size-6 rounded-lg border border-[rgba(197,197,197,0.24)]" />
                      <span className="absolute left-[7px] top-[7px] flex size-3.5 items-center justify-center text-white">
                        <svg aria-hidden="true" width="24px" height="24px" viewBox="0 0 24 24" fill="none">
                          <path d="M15.25 8.75V3.75C15.25 3.19772 14.8023 2.75 14.25 2.75H3.75C3.19772 2.75 2.75 3.19772 2.75 3.75V14.25C2.75 14.8023 3.19772 15.25 3.75 15.25H8.75M3.1 11.9L5.44718 10.3622C5.78243 10.1425 6.21643 10.1443 6.54991 10.3666L8.37885 11.5859M6 6.25H6.5M14.5 15.0002H15M6.75 6.25C6.75 6.52614 6.52614 6.75 6.25 6.75C5.97386 6.75 5.75 6.52614 5.75 6.25C5.75 5.97386 5.97386 5.75 6.25 5.75C6.52614 5.75 6.75 5.97386 6.75 6.25ZM13.75 13.2V16.8L16.55 15L13.75 13.2ZM20.25 21.25H9.75C9.19772 21.25 8.75 20.8023 8.75 20.25V9.75C8.75 9.19772 9.19772 8.75 9.75 8.75H20.25C20.8023 8.75 21.25 9.19772 21.25 9.75V20.25C21.25 20.8023 20.8023 21.25 20.25 21.25Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </span>
                    <span className="text-xs font-semibold whitespace-nowrap">All generations</span>
                  </button>

                  {/* MY FAVORITES */}
                  <button
                    type="button"
                    onClick={() => onViewChange("favorites")}
                    className={cn(
                      "group flex items-center gap-2 h-9 px-1.5 rounded-xl transition-colors duration-150 overflow-hidden text-left",
                      activeSidebarView === "favorites" ? "bg-white/10 text-white" : "hover:bg-white/5 text-white/70"
                    )}
                  >
                    <span aria-hidden="true" className="relative block size-7 shrink-0 overflow-visible">
                      <span className="absolute left-0.5 top-0.5 size-6 overflow-hidden rounded-lg shadow-[0_4px_4px_0_rgba(0,0,0,0.08),inset_0_2px_4px_0_rgba(255,255,255,0.24)] bg-[linear-gradient(135deg,#E251B4_3.87%,#8D1237_93.45%)]" />
                      <span className="pointer-events-none absolute left-0.5 top-0.5 size-6 rounded-lg bg-[linear-gradient(0deg,rgba(0,0,0,0)_0%,rgba(255,255,255,1)_100%)] opacity-20 mix-blend-overlay" />
                      <span className="pointer-events-none absolute left-0.5 top-0.5 size-6 rounded-lg bg-[linear-gradient(0deg,rgba(0,0,0,0)_0%,rgba(255,255,255,1)_100%)] opacity-32 mix-blend-hard-light" />
                      <span className="pointer-events-none absolute left-0.5 top-0.5 size-6 rounded-lg border border-[rgba(197,197,197,0.24)]" />
                      <span className="absolute left-[7px] top-[7px] flex size-3.5 items-center justify-center text-white">
                        <svg aria-hidden="true" width="24px" height="24px" viewBox="0 0 24 24" fill="none">
                          <path d="M21.25 9.9375C21.25 15.8672 12.7708 20.25 12 20.25C11.2292 20.25 2.75 15.8672 2.75 9.9375C2.75 5.8125 5.31944 3.75 7.88889 3.75C10.4583 3.75 12 5.29688 12 5.29688C12 5.29688 13.5417 3.75 16.1111 3.75C18.6806 3.75 21.25 5.8125 21.25 9.9375Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </span>
                    <span className="text-xs font-semibold whitespace-nowrap">My favorites</span>
                  </button>
                </div>

                {/* TOOLS SECTION */}
                <div className="shrink-0 flex flex-col mt-4">
                  <div className="shrink-0 px-3.5 mb-1 overflow-hidden">
                    <span className="text-xs font-medium text-white/50">Tools</span>
                  </div>
                  <div className="flex flex-col gap-px px-1.5">
                    {/* PRODUCT LINK */}
                    <button
                      type="button"
                      className="group flex h-9 w-full items-center gap-2 overflow-hidden rounded-xl px-1.5 transition-colors duration-150 hover:bg-white/5 text-white/70"
                    >
                      <span aria-hidden="true" className="relative block size-7 shrink-0 overflow-visible">
                        <span className="absolute left-0.5 top-0.5 size-6 overflow-hidden rounded-lg shadow-[0_4px_4px_0_rgba(0,0,0,0.08),inset_0_2px_4px_0_rgba(255,255,255,0.24)] bg-[linear-gradient(135deg,#51B4E2_3.8675%,#1840B6_93.451%)]" />
                        <span className="pointer-events-none absolute left-0.5 top-0.5 size-6 rounded-lg bg-[linear-gradient(0deg,rgba(0,0,0,0)_0%,rgba(255,255,255,1)_100%)] opacity-20 mix-blend-overlay" />
                        <span className="pointer-events-none absolute left-0.5 top-0.5 size-6 rounded-lg bg-[linear-gradient(0deg,rgba(0,0,0,0)_0%,rgba(255,255,255,1)_100%)] opacity-32 mix-blend-hard-light" />
                        <span className="absolute left-[5px] top-[5px] flex size-[18px] items-center justify-center text-white">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                            <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M11 2.75V4.5m5.907.593-1.31 1.31m-9.193 9.193-1.31 1.31M4.5 11H2.75m3.654-4.596-1.31-1.31m9.217 15.895-3.866-10.461a.25.25 0 0 1 .327-.319l10.24 4.096a.25.25 0 0 1 .028.45l-3.978 2.21a.25.25 0 0 0-.097.097l-2.2 3.962a.25.25 0 0 1-.454-.035" />
                          </svg>
                        </span>
                      </span>
                      <span className="whitespace-nowrap text-xs font-semibold">Product Link</span>
                    </button>

                    {/* AD REFERENCE */}
                    <button
                      type="button"
                      className="group flex h-9 w-full items-center gap-2 overflow-hidden rounded-xl px-1.5 transition-colors duration-150 hover:bg-white/5 text-white/70"
                    >
                      <span aria-hidden="true" className="relative block size-7 shrink-0 overflow-visible">
                        <span className="absolute left-0.5 top-0.5 size-6 overflow-hidden rounded-lg shadow-[0_4px_4px_0_rgba(0,0,0,0.08),inset_0_2px_4px_0_rgba(255,255,255,0.24)] bg-[linear-gradient(135deg,#E251B4_3.8675%,#8D1237_93.451%)]" />
                        <span className="pointer-events-none absolute left-0.5 top-0.5 size-6 rounded-lg bg-[linear-gradient(0deg,rgba(0,0,0,0)_0%,rgba(255,255,255,1)_100%)] opacity-20 mix-blend-overlay" />
                        <span className="pointer-events-none absolute left-0.5 top-0.5 size-6 rounded-lg bg-[linear-gradient(0deg,rgba(0,0,0,0)_0%,rgba(255,255,255,1)_100%)] opacity-32 mix-blend-hard-light" />
                        <span className="absolute left-[5px] top-[5px] flex size-[18px] items-center justify-center text-white">
                          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                            <path d="M12.6606 7.13965C13.1331 7.09466 13.5682 7.27467 13.9507 7.55957C14.3256 7.84452 14.6705 8.25738 15.0005 8.75977C15.653 9.77223 16.2908 11.2423 16.9058 13.1172V13.1396C16.9807 13.3646 17.0479 13.5749 17.0854 13.7549H17.1011C17.1386 13.9499 17.1679 14.1601 17.1079 14.3926C17.0254 14.7075 16.816 14.9929 16.5386 15.1729C16.3361 15.3003 16.1183 15.3453 15.9233 15.3604C15.7358 15.3754 15.5107 15.375 15.2632 15.375H3.32373C3.09123 15.375 2.88068 15.3754 2.70068 15.3604C2.50583 15.3454 2.29594 15.3001 2.10107 15.1729C1.82357 15.0004 1.60576 14.6998 1.53076 14.3848C1.47081 14.1598 1.48577 13.957 1.53076 13.7695C1.56828 13.6046 1.6355 13.4094 1.71045 13.207V13.1846C1.95795 12.4496 2.31874 11.5347 2.78369 10.7998C3.01615 10.4324 3.28615 10.0798 3.60107 9.81738C3.92343 9.55505 4.32062 9.35268 4.77783 9.35254C5.64783 9.35254 6.36869 9.82523 6.90869 10.1777C6.93856 10.2001 6.97553 10.2228 7.00537 10.2451C7.25287 10.4026 7.46306 10.5454 7.66553 10.6504C7.89792 10.7703 8.06311 10.8144 8.20556 10.8145C8.27307 10.8145 8.43064 10.7623 8.72314 10.4473C8.93313 10.2223 9.14363 9.93771 9.39111 9.61523C9.47361 9.51023 9.56283 9.68612 10.0488 9.57324L10.0498 9.57422C10.7354 8.68059 11.5565 7.73005 12.7012 7.6377H12.708ZM7.45508 3.5C8.62865 3.5 9.58008 4.4514 9.58008 5.625C9.58008 6.7986 8.62865 7.74902 7.45508 7.74902C6.28174 7.74864 5.33008 6.79831 5.33008 5.625C5.33008 4.45169 6.28174 3.50039 7.45508 3.5Z" fill="rgba(255,255,255,0.7)" />
                          </svg>
                        </span>
                      </span>
                      <span className="whitespace-nowrap text-xs font-semibold">Ad Reference</span>
                    </button>
                  </div>
                </div>

                {/* PROJECTS SECTION */}
                <div className="shrink-0 overflow-hidden px-2 pb-0.5 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsProjectsOpen(!isProjectsOpen)}
                    className="flex h-6 w-full items-center justify-between gap-2 pl-1.5 pr-1 text-white/50 hover:text-white"
                  >
                    <span className="text-xs font-medium">Projects</span>
                    <div className={cn("transition-transform duration-150", isProjectsOpen ? "rotate-180" : "rotate-0")}>
                      <svg className="size-4" aria-hidden="true" width="24px" height="24px" viewBox="0 0 24 24" fill="none">
                        <path d="M8 10L11.6464 13.6464C11.8417 13.8417 12.1583 13.8417 12.3536 13.6464L16 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  </button>

                  {isProjectsOpen && (
                    <button
                      type="button"
                      className="mt-1.5 flex h-9 w-full items-center gap-2 rounded-xl px-1.5 text-left text-xs font-medium text-white/60 transition-colors hover:text-white"
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-lg text-white border border-white/20 bg-white/[0.04]">
                        <svg className="size-4" aria-hidden="true" width="24px" height="24px" viewBox="0 0 24 24" fill="none">
                          <path fillRule="evenodd" clipRule="evenodd" d="M12 6C12.4142 6 12.75 6.33579 12.75 6.75V11.25H17.25C17.6642 11.25 18 11.5858 18 12C18 12.4142 17.6642 12.75 17.25 12.75H12.75V17.25C12.75 17.6642 12.4142 18 12 18C11.5858 18 11.25 17.6642 11.25 17.25V12.75H6.75C6.33579 12.75 6 12.4142 6 12C6 11.5858 6.33579 11.25 6.75 11.25H11.25V6.75C11.25 6.33579 11.5858 6 12 6Z" fill="currentColor" />
                        </svg>
                      </span>
                      <span className="truncate">New project</span>
                    </button>
                  )}
                </div>

                {/* FOOTER SECTION */}
                <div className="shrink-0 mb-3 px-2 flex flex-col gap-2 mt-auto">
                  {/* LOG IN BUTTON */}
                  <button
                    type="button"
                    className="flex items-center justify-start shrink-0 rounded-full border border-white/10 transition-colors text-xs font-medium text-white hover:bg-white/5 h-9 w-full gap-2 px-3"
                  >
                    <svg className="size-4 shrink-0 text-white/70" aria-hidden="true" width="24px" height="24px" viewBox="0 0 24 24" fill="none">
                      <path fillRule="evenodd" clipRule="evenodd" d="M19.25 4.5L14.75 4.5C14.3358 4.5 14 4.16421 14 3.75C14 3.33579 14.3358 3 14.75 3L19.25 3C20.2165 3 21 3.7835 21 4.75V19.25C21 20.2165 20.2165 21 19.25 21H14.75C14.3358 21 14 20.6642 14 20.25C14 19.8358 14.3358 19.5 14.75 19.5H19.25C19.3881 19.5 19.5 19.3881 19.5 19.25V4.75C19.5 4.61193 19.3881 4.5 19.25 4.5ZM10.9697 7.96967C11.2626 7.67678 11.7374 7.67678 12.0303 7.96967L15.5303 11.4697C15.671 11.6103 15.75 11.8011 15.75 12C15.75 12.1989 15.671 12.3897 15.5303 12.5303L12.0303 16.0303C11.7374 16.3232 11.2626 16.3232 10.9697 16.0303C10.6768 15.7374 10.6768 15.2626 10.9697 14.9697L13.1893 12.75H3.75C3.33579 12.75 3 12.4142 3 12C3 11.5858 3.33579 11.25 3.75 11.25H13.1893L10.9697 9.03033C10.6768 8.73744 10.6768 8.26257 10.9697 7.96967Z" fill="currentColor" />
                    </svg>
                    <span>Log in</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
