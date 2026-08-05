"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useAuthModal } from "@/context/AuthModalContext";
import PasswordSignIn from "./PasswordSignIn";

export default function CinefieldAuthModal() {
  const { isOpen, mode, closeModal } = useAuthModal();
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  useEffect(() => {
    if (isOpen && portalRoot) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen, portalRoot]);

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

  if (!isOpen || !portalRoot) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={closeModal}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-[900px] bg-black rounded-xl shadow-2xl grid grid-cols-1 md:grid-cols-[45%_55%] border border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={closeModal}
          className="absolute top-4 right-4 z-10 p-2 rounded-full hover:bg-white/10"
        >
          <X className="h-5 w-5 text-white" />
        </button>

        <div className="hidden md:flex flex-col justify-center items-center p-12 bg-gradient-to-br from-black via-slate-900 to-black">
          <div className="text-center max-w-sm">
            <img
              src="/cinefield-logo.png"
              alt="CINEFIELD"
              className="h-16 w-16 rounded-xl mx-auto mb-8"
            />
            <h2 className="text-3xl font-bold text-white mb-4">
              Create with AI Power
            </h2>
            <p className="text-zinc-300 text-base mb-8">
              Access advanced video, image, and audio generation tools
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-center items-center p-6 md:p-8 bg-black">
          <div className="w-full max-w-sm">
            {/* Single shared panel for both Login and Sign Up — intent is
                passed via `mode`, the visual shell/screens are identical. */}
            <PasswordSignIn mode={mode} onSuccess={closeModal} />
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, portalRoot);
}
