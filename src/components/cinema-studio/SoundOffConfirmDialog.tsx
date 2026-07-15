"use client";

interface SoundOffConfirmDialogProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirms turning Sound Off (Google Veo 3.1 Lite only). Off -> On never shows this.
 * Matches the app's existing hand-rolled modal convention (see AssetsPickerModal).
 */
export default function SoundOffConfirmDialog({
  isOpen,
  onCancel,
  onConfirm,
}: SoundOffConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-labelledby="sound-off-title"
        aria-describedby="sound-off-description"
        className="w-[calc(100vw-1.5rem)] max-w-md rounded-2xl border border-white/10 bg-[rgba(24,26,30,0.98)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="sound-off-title" className="text-lg font-semibold text-white">
          Turn sound off?
        </h2>
        <p id="sound-off-description" className="mt-2 text-sm text-neutral-400">
          This generation will be created without generated audio.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-white/90"
          >
            Turn off
          </button>
        </div>
      </div>
    </div>
  );
}
