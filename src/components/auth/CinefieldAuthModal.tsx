"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SignUp } from "@clerk/nextjs";
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

  const signInMode = mode === "signin";
  const signUpMode = mode === "signup";

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
            {signInMode && <PasswordSignIn onSuccess={closeModal} />}
            {signUpMode && (
              <SignUp
                routing="hash"
                appearance={{
                  variables: {
                    colorBackground: "#000000",
                    colorPrimary: "#D97757",
                    borderRadius: "12px",
                  },
                  elements: {
                    rootBox: "w-full",
                    card: "bg-black shadow-none border-0 rounded-2xl p-0 w-full",
                    cardBox: "shadow-none border-0",
                    headerTitle: "text-white text-2xl font-bold",
                    headerSubtitle: "text-gray-300 text-sm",
                    dividerLine: "bg-gray-700",
                    dividerText: "text-gray-400",
                    formFieldLabel: "text-gray-200 font-medium text-sm",
                    formFieldInput:
                      "bg-gray-800 border border-gray-600 text-white placeholder-gray-500 rounded-xl focus:border-[#D97757] focus:ring-1 focus:ring-[#D97757] h-11",
                    formButtonPrimary:
                      "bg-[#D97757] hover:bg-[#c9684a] text-white font-semibold rounded-xl h-11",
                    formButtonSecondary:
                      "border border-gray-600 bg-black text-white hover:border-gray-500 rounded-xl",
                    formResendCodeLink: "text-[#D97757] hover:text-[#e98566]",
                    socialButton:
                      "border border-gray-600 hover:border-gray-500 hover:bg-gray-800 text-white rounded-xl h-11",
                    socialButtonText: "text-white font-medium",
                    socialButtonsBlockButton:
                      "border border-gray-600 hover:border-gray-500 hover:bg-gray-800 text-white rounded-xl h-11",
                    socialButtonsBlockButtonText: "text-white font-medium",
                    footerActionText: "text-gray-400 text-sm",
                    footerActionLink: "text-[#D97757] hover:text-[#e98566] font-medium",
                    identityPreviewText: "text-gray-300 text-sm",
                    formFieldErrorText: "text-red-400 text-sm",
                    alertText: "text-red-400 text-sm",
                    otpCodeFieldInput:
                      "w-12 h-14 bg-zinc-800 border border-gray-500 text-white text-center text-lg font-bold rounded-lg focus:border-[#D97757] focus:ring-2 focus:ring-[#D97757]",
                    footer: "text-gray-500 text-xs",
                    footerPages: "text-gray-500 text-xs",
                    badge: "bg-gray-800 text-gray-300 text-xs",
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
