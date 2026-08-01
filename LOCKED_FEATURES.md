# LOCKED MODULES AND STYLING PROTECTION

> [!IMPORTANT]
> The `/generate` page (http://localhost:3000/generate) and all underlying Cinema Studio components are **COMPLETELY LOCKED** by explicit user directive as of 2026-08-01.

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

## Protection Directives

- DO NOT modify, refactor, reorder, or alter any layout, styling, animations, or model definitions within these locked paths.
- Future changes in other sections of the website MUST NOT touch or regress the `/generate` page.
