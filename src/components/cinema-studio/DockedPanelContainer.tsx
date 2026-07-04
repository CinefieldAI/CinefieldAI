"use client";

import { ReactNode } from "react";

interface DockedPanelContainerProps {
  open: boolean;
  children: ReactNode;
}

export default function DockedPanelContainer({
  open,
  children,
}: DockedPanelContainerProps) {
  if (!open) return null;

  return (
    <div className="fixed top-[28vh] left-1/2 -translate-x-1/2 z-[500] w-[min(876px,calc(100vw-32px))]">
      {/* Docked panel — sits below chip bar, not fullscreen */}
      <div className="relative overflow-hidden rounded-[20px] p-1 backdrop-blur-[20px] shadow-[0_12px_8px_0_rgba(0,0,0,0.20),inset_0_0_0_1px_rgba(217,217,217,0.04)] bg-gradient-to-b from-[rgba(21,21,21,0.88)] to-[rgba(21,21,21,0.88)]">
        {children}
      </div>
    </div>
  );
}
