# LOCKED MODULES AND STYLING PROTECTION

> [!IMPORTANT]
> The `/generate` page (http://localhost:3000/generate) and all underlying Cinema Studio / Prompt Bar components are **STRICTLY LOCKED** by explicit user directive on **2026-08-01 (Current Status: LOCKED & PROTECTED)**.

## Locked Components & Paths

1. `src/app/generate/page.tsx`
2. `src/components/cinema-studio/*`
   - `CinemaStudioWorkspace.tsx`
   - `PromptBar.tsx`
   - `ModelSelector.tsx`
   - `CinemaStudioImagePanel.tsx`
   - `CinemaStudio25DirectorPanel.tsx`
   - `Cinema3DirectorsPanel.tsx`
   - `KlingAdvancedSettingsPanel.tsx`
   - `AspectRatioDropdown.tsx`
   - `ResolutionPopover.tsx`
   - `DurationPopover.tsx`
   - `cinemaStudioData.ts`
3. Navigation Mega Dropdowns (Active Orange Glow System):
   - `src/components/landing/ImageMegaDropdown.tsx`
   - `src/components/landing/VideoMegaDropdown.tsx`
   - `src/components/landing/AudioMegaDropdown.tsx`
   - **Re-locked 2026-08-01:** briefly unlocked by explicit user request to reduce title font size (18px → 16px) and rebalance icon sizing to match (icon container size-14 → size-12, icon glyph size-7 → size-6) across all three dropdowns. Immediately re-locked after.

## Protection Directives

- **DO NOT MODIFY, REFACTOR, REORDER, OR ALTER** any layout, styling, animations, colors, icons, or model definitions within these locked paths under any circumstances.
- All future feature requests, edits, or additions MUST leave the `/generate` page and its associated components completely untouched.
- Any attempt to modify these files requires explicit unlocking authorization from the user.

---

> [!IMPORTANT]
> The `/audio/create` page (http://localhost:3000/audio/create) — the full Audio Create workspace (rotary Voiceover / Change Voice / Translate selector, model composer, all controls) — is **STRICTLY LOCKED** by explicit user directive on **2026-08-01 (Current Status: LOCKED & PROTECTED)**.

## Locked Components & Paths

1. `src/app/audio/create/page.tsx`
2. `src/components/landing/createAudio/*`
   - `CreateAudioWorkspace.tsx`
   - `AudioComposer.tsx`
   - `RotarySelector.tsx`
   - `AudioTopControls.tsx`
   - `AudioFeed.tsx`
   - `voiceoverModelConfig.ts`
   - `SelectVoiceModal.tsx`
   - `ChooseLanguageModal.tsx`
3. `src/components/landing/audioMenuData.ts` (AUDIO_MODELS / AUDIO_FEATURES sections)

## Protection Directives

- **DO NOT MODIFY, REFACTOR, REORDER, OR ALTER** any layout, styling, animations, colors, icons, or model definitions within these locked paths under any circumstances.
- All future feature requests, edits, or additions MUST leave the `/audio/create` page and its associated components completely untouched.
- Any attempt to modify these files requires explicit unlocking authorization from the user.
- **Known deferred gap (documented, not to be silently "fixed"):** Translate mode's target-language selector and its own Sample Rate/Speed/Volume/Pitch/Output row (`translateSampleRate` etc. in `CreateAudioWorkspace.tsx`) are wired into state and props but not yet rendered in `AudioComposer.tsx` — Translate currently shows the same simple UI as Change Voice (reference video + voice preset + Generate). This stays as-is under the lock unless the user explicitly asks to unlock and finish it.
