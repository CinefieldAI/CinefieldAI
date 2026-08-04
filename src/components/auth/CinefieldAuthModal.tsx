"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SignIn, SignUp } from "@clerk/nextjs";
import { X } from "lucide-react";
import { useAuthModal } from "@/context/AuthModalContext";

export default function CinefieldAuthModal() {
  const { isOpen, mode, closeModal } = useAuthModal();
  const [mounted, setMounted] = useState(false);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
    setPortalRoot(document.body);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        closeModal();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, closeModal]);

  if (!mounted || !isOpen || !portalRoot) return null;

  const overlayRef = (el: HTMLDivElement | null) => {
    if (el && isOpen) {
      const rect = el.getBoundingClientRect();
      if (typeof window !== "undefined") {
        console.log("[Modal Overlay] viewport rect:", {
          width: window.innerWidth,
          height: window.innerHeight,
          dvh: `calc(100dvh) = ${window.innerHeight}px`,
        });
        console.log("[Modal Overlay] overlay bounding rect:", {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
      }
    }
  };

  const modalRef = (el: HTMLDivElement | null) => {
    if (el && isOpen) {
      const rect = el.getBoundingClientRect();
      const centerY = window.innerHeight / 2;
      console.log("[Modal Card] bounding rect:", {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        centerY: rect.top + rect.height / 2,
        expectedCenterY: centerY,
        centered: Math.abs(rect.top + rect.height / 2 - centerY) < 10,
      });
    }
  };

  const modal = (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      style={{ width: "100vw", height: "100dvh", minHeight: "100dvh" }}
      onClick={closeModal}
      role="presentation"
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-[820px] h-auto max-h-[calc(100dvh-32px)] bg-black rounded-2xl overflow-x-hidden overflow-y-auto shadow-2xl grid grid-cols-1 md:grid-cols-2"
        style={{ margin: 0, position: "relative" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={closeModal}
          className="absolute top-4 right-4 z-10 p-2 rounded-full hover:bg-white/10 transition-colors"
          aria-label="Close modal"
        >
          <X className="h-5 w-5 text-white" />
        </button>

        {/* Left Promo Panel */}
        <div className="hidden md:flex flex-col justify-center items-center p-12 bg-gradient-to-br from-black via-slate-900 to-black relative overflow-hidden">
          {/* Decorative gradient overlay */}
          <div className="absolute inset-0 opacity-30">
            <div className="absolute top-0 left-0 w-96 h-96 bg-[#D97757] rounded-full blur-3xl opacity-20" />
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-slate-700 rounded-full blur-3xl opacity-20" />
          </div>

          {/* Content */}
          <div className="relative z-10 text-center max-w-sm">
            <div className="mb-8">
              <img
                src="/cinefield-logo.png"
                alt="CINEFIELD"
                className="h-16 w-16 rounded-xl mx-auto object-cover drop-shadow-[0_0_8px_rgba(217,119,87,0.5)]"
              />
            </div>

            <h2 className="text-3xl font-bold text-white mb-4">
              Create with AI Power
            </h2>

            <p className="text-zinc-300 text-base leading-relaxed mb-8">
              Access advanced video, image, and audio generation tools. Join
              creators pushing the boundaries of content.
            </p>

            <div className="flex items-center justify-center gap-2">
              <div className="h-1 w-8 bg-[#D97757] rounded-full" />
              <span className="text-sm text-zinc-400 uppercase tracking-widest">
                Premium Creation
              </span>
              <div className="h-1 w-8 bg-[#D97757] rounded-full" />
            </div>
          </div>
        </div>

        {/* Right Auth Panel */}
        <div className="flex flex-col justify-center items-center p-8 md:p-12 bg-black">
          <div className="w-full">
            <div className="mb-8 text-center md:hidden">
              <img
                src="/cinefield-logo.png"
                alt="CINEFIELD"
                className="h-12 w-12 rounded-lg mx-auto object-cover drop-shadow-[0_0_8px_rgba(217,119,87,0.5)]"
              />
            </div>

            {mode === "signin" ? (
              <SignIn
                appearance={{
                  variables: {
                    colorBackground: "#000000",
                    colorPrimary: "#D97757",
                    borderRadius: "12px",
                  },
                  elements: {
                    card: "bg-black shadow-none border-0 rounded-2xl p-0",
                    cardBox: "shadow-none border-0",
                    headerTitle: "text-white text-2xl font-bold",
                    headerSubtitle: "text-zinc-400",
                    dividerLine: "bg-white/10",
                    dividerText: "text-zinc-500",
                    formFieldLabel: "text-white font-medium",
                    formFieldInput:
                      "bg-zinc-900 border border-zinc-700 text-white placeholder-zinc-500 rounded-xl",
                    formButtonPrimary:
                      "bg-[#D97757] hover:bg-[#c9684a] text-white font-semibold rounded-xl",
                    formResendCodeLink: "text-[#D97757] hover:text-[#e98566]",
                    socialButton:
                      "border border-zinc-700 hover:bg-white/5 text-white rounded-xl",
                    socialButtonText: "text-white",
                    footerActionText: "text-zinc-400",
                    footerActionLink: "text-[#D97757] hover:text-[#e98566]",
                  },
                }}
              />
            ) : (
              <SignUp
                appearance={{
                  variables: {
                    colorBackground: "#000000",
                    colorPrimary: "#D97757",
                    borderRadius: "12px",
                  },
                  elements: {
                    card: "bg-black shadow-none border-0 rounded-2xl p-0",
                    cardBox: "shadow-none border-0",
                    headerTitle: "text-white text-2xl font-bold",
                    headerSubtitle: "text-zinc-400",
                    dividerLine: "bg-white/10",
                    dividerText: "text-zinc-500",
                    formFieldLabel: "text-white font-medium",
                    formFieldInput:
                      "bg-zinc-900 border border-zinc-700 text-white placeholder-zinc-500 rounded-xl",
                    formButtonPrimary:
                      "bg-[#D97757] hover:bg-[#c9684a] text-white font-semibold rounded-xl",
                    formResendCodeLink: "text-[#D97757] hover:text-[#e98566]",
                    socialButton:
                      "border border-zinc-700 hover:bg-white/5 text-white rounded-xl",
                    socialButtonText: "text-white",
                    footerActionText: "text-zinc-400",
                    footerActionLink: "text-[#D97757] hover:text-[#e98566]",
                  },
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, portalRoot);
}
