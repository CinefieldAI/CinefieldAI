"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Extra classes for the card (size etc). */
  className?: string;
  /** Skip the default card chrome (bg/border/shadow/radius) — the children own their own panel styling. */
  bare?: boolean;
}

/**
 * Bare centered modal shell — portal + blurred backdrop + fade/scale card.
 * Layout (header/close) is owned by each modal. z-[1000] sits above dropdowns.
 */
export default function ModalShell({
  open,
  onClose,
  children,
  className = "",
  bare = false,
}: ModalShellProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-[40px]"
          />
          <motion.div
            initial={{ scale: 0.96, y: 12, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.97, y: 8, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className={
              bare
                ? `relative z-10 ${className}`
                : `relative z-10 overflow-hidden rounded-[24px] border border-white/10 bg-[#1a1d1f] shadow-2xl ${className}`
            }
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
