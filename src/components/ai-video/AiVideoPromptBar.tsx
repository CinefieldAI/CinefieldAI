"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useToolbarNav } from "@/hooks/useToolbarNav";
import AiVideoModelSelector from "./AiVideoModelSelector";
import { AspectRatioControl, AudioToggleControl, DurationListControl, DurationSliderControl } from "./AiVideoControls";
import { AI_VIDEO_DEFAULT_MODEL, getControlSpec } from "./aiVideoModels";

/**
 * The /ai-video prompt bar. Layout follows the reference's own: one flexible
 * left column holding the upload button + prompt on the first line and the
 * control row beneath it, with Generate as a tall block on the right.
 *
 * Which controls exist is entirely model-driven — an Edit or Motion Control
 * model legitimately leaves nothing but the model pill and Generate, and the
 * three that do appear always come in the order duration, ratio, sound.
 *
 * `model` holds a model **id**, not a display name; two Kling models share
 * each of two names.
 */
export default function AiVideoPromptBar() {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(AI_VIDEO_DEFAULT_MODEL);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toolbarNav = useToolbarNav();

  const spec = getControlSpec(model);
  const [duration, setDuration] = useState(spec.defaultDuration ?? "");
  const [ratio, setRatio] = useState(spec.defaultRatio ?? spec.ratios?.[0] ?? "");
  const [audioOn, setAudioOn] = useState(true);

  /** Every model carries its own duration range and ratio set, so a value
   *  the new model doesn't offer has to snap back to one it does rather
   *  than carry over. The opening ratio is not always the first in the list —
   *  Seedance opens on `Auto`, Kling on `16:9`, Kling O1 on `1:1`. */
  const handleModelChange = (id: string) => {
    const next = getControlSpec(id);
    setModel(id);
    setDuration(next.defaultDuration ?? "");
    setRatio(next.defaultRatio ?? next.ratios?.[0] ?? "");
    setAudioOn(true);
  };

  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      className="relative mx-auto flex w-full max-w-[792px] items-start justify-center gap-3 overflow-hidden rounded-[20px] bg-white/5 p-3"
    >
      <div className="flex min-h-14 min-w-0 flex-1 flex-col gap-1 rounded-xl">
        <label className="sr-only" htmlFor="ai-video-prompt">
          Prompt
        </label>

        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            {/* Images only, one at a time — the reference accepts no video
                here, not even on its Edit models. */}
            <input ref={fileInputRef} type="file" accept="image/*" className="sr-only" />
            <button
              type="button"
              aria-label="Upload image"
              onClick={() => fileInputRef.current?.click()}
              className="flex size-8 items-center justify-center rounded-[10px] border border-[#d9d9d9]/[0.04] bg-white/5 text-white/90 transition-colors hover:bg-white/10"
            >
              <Plus className="size-4" />
            </button>
          </div>

          <textarea
            id="ai-video-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe any visual idea. We will generate a video."
            className="hide-scrollbar h-12 min-w-0 flex-1 resize-none bg-transparent text-sm leading-5 tracking-[0.1px] text-white outline-none placeholder:text-[#828282]"
          />
        </div>

        <div {...toolbarNav.containerProps} className="prompt-control-row flex flex-wrap items-center gap-1">
          <AiVideoModelSelector selected={model} onSelect={handleModelChange} />

          {spec.durationRange && (
            <DurationSliderControl
              value={duration}
              min={spec.durationRange[0]}
              max={spec.durationRange[1]}
              onChange={setDuration}
            />
          )}
          {spec.durationOptions && (
            <DurationListControl value={duration} options={spec.durationOptions} onChange={setDuration} />
          )}

          {spec.ratios && <AspectRatioControl value={ratio} options={spec.ratios} onChange={setRatio} />}

          {spec.audio && <AudioToggleControl on={audioOn} onChange={setAudioOn} />}
        </div>
      </div>

      <button
        type="submit"
        className="relative flex h-20 w-[97px] shrink-0 items-center justify-center rounded-xl bg-[#D97757] text-sm font-bold text-[#131517] shadow-[10px_34px_24px_rgba(0,0,0,0.15),3px_7px_5px_rgba(0,0,0,0.12)] transition-opacity hover:opacity-90"
      >
        Generate
      </button>
    </form>
  );
}
