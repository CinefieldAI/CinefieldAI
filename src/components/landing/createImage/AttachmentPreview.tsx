"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ImageIcon, Loader2, X } from "lucide-react";
import type { ReferenceAttachment } from "./createImageData";

interface AttachmentPreviewProps {
  attachments: ReferenceAttachment[];
  onRemove: (id: string) => void;
}

export default function AttachmentPreview({ attachments, onRemove }: AttachmentPreviewProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 px-4 pt-4">
      <AnimatePresence initial={false}>
        {attachments.map((file) => (
          <motion.div
            key={file.id}
            layout
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="group relative h-14 w-14 overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]"
          >
            {file.loading ? (
              <div className="flex h-full w-full items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-magenta-400" />
              </div>
            ) : file.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- local blob preview, optimization N/A
              <img src={file.url} alt={file.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-zinc-500">
                <ImageIcon className="h-4 w-4" />
              </div>
            )}

            <button
              type="button"
              aria-label={`Remove ${file.name}`}
              onClick={() => onRemove(file.id)}
              className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-zinc-300 opacity-0 backdrop-blur-md transition-opacity hover:bg-magenta-500 hover:text-white group-hover:opacity-100"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
