<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Locked routes — do not modify without an explicit user request

**/generate is FULLY LOCKED as of commit `cd94e62` (2026-08-09).** The user
finalized it (Claude session + Codex's "Soften generate page background" /
"Smooth generate hero transition" work) and asked for it to be frozen. That
covers `src/app/generate/page.tsx` and everything under
`src/components/cinema-studio/` it renders, plus the `/generate`-scoped rules
in globals.css (`.hide-page-scrollbar`, `body:has(.cinema-generate-workspace)`
— both scrollbar mechanisms are intentional; do not deduplicate them).

Only a user instruction that explicitly names /generate unlocks the specific
change requested — everything else on the page stays as committed. Do not
"improve", restyle, or clean it up in passing.

**Cinema Studio 4.0 is FULLY LOCKED as of commit `1ef4162` (2026-08-17).**
The Genre arc / Camera Setup wheels / Tempo carousel must key rendered
items by their own identity (name), not by slot position, with each
item's offset from the selected index recomputed via shortest-path
wraparound every render and a CSS transition on transform+opacity — this
is what makes the whole assembly spin smoothly on Next/Prev instead of
instantly swapping content in place. Don't revert to slot-keyed rendering.
The model entry in `cinemaStudioData.ts` (id `cinema-studio-4.0`), the
`CinemaStudio40CreativeControls.tsx` component (the References/Film
setup/Camera/Color palette/Lighting pill row and its four dialogs),
`Cinema40AssetsPicker.tsx` (the References chip's own two-tier Assets
picker), and every `isCinema40`-gated block in `CinemaStudioWorkspace.tsx`
and `PromptBar.tsx` are frozen at that commit. First built at `879400d`
from a prose description; fully rewritten at `e9e1dcf` against the
reference's actual DOM markup (Genre arc, Era ruler, Tempo carousel,
Camera Setup wheels, Movement grid, Color palette grid, Lighting grid all
use its real geometry/formulas/option lists — none of it invented); then
`Cinema40AssetsPicker.tsx` added at `fdfff92` matching the reference's
separate "Assets v2" dialog (References/Elements/Generations/Liked ×
Recent/All/Images/Videos/Audio tab tiers, multiple-file upload, stays
open after upload). All option arrays live in `cinemaStudioData.ts` as
`CINEMA40_*` (not shared with the generic `GENRES`/`COLOR_PALETTES`/
`LIGHTING`). Colour tokens and the accent (#D97757) are this project's
own, not the reference's; the reference's real photography/video was
deliberately not downloaded — gradient swatches stand in. Prev/Next click
stepping and mouse-wheel stepping both work on Genre/Tempo/Camera: wheel
handling is a shared `useWheelStep` hook (gated by a delta threshold and
a 220ms cooldown so one swipe advances one step), used by `StepperNav`'s
own pill (Genre, Tempo) and, as of `27920ba`, by `GenreArc`'s whole root
div too, so scrolling anywhere over the genre arc — not just the small
pill — steps it; `StepperNav`'s handler calls `stopPropagation` so the
nested pill doesn't double-step. `439d1d9` fixed `GenreArc`'s root div
missing `flex flex-col`, which had left its pill sitting above the card
instead of below it like `TempoCarousel`; `27920ba` also removed the
selected genre card's static `cursor-pointer` (its click is a no-op when
already selected) in favor of `cursor-default`, leaving neighbor cards
`cursor-pointer` since clicking them does select.

Era (Film setup tab) is the one exception to "no pointer-drag yet": as of
`1ef4162` it has its own `RulerScrubber.tsx` component with real
pointer-drag, wheel, and keyboard (Left/Right/Home/End) scrubbing, plus a
synthesized tick sound (`src/lib/cinema-studio-4/tick-sound.ts`,
`playTick(rate)` — a Web Audio click whose pitch is driven by a
velocity-derived `rate` multiplier clamped to ~0.85–1.5, not a random
jitter or a fixed per-tick-type preset). Both were reverse-engineered by
instrumenting the reference site's own Web Audio calls live: every tick
plays an identical short sample with only `playbackRate` varying with
drag speed, there is no separate "major"/"settle" sound, and Prev/Next
or direct label clicks are silent — `RulerScrubber` only calls
`playTick` from actual drag/wheel motion, never from `step()`/`jumpTo()`.
Era is also cyclic like Genre/Tempo (dragging past "Auto" wraps to
"1960s", confirmed against the reference), using the same shortest-path-
wraparound-from-a-continuous-position technique, extended to a
fractional live position so it tracks a continuous gesture rather than
just discrete steps — this applies to both the selectable-item labels
and the decorative tick marks (an earlier version kept the ticks as a
fixed 81-tick window centered on index 0, which ran out of ticks and
went blank once the wraparound let selection reach "Auto"; both now use
the same per-slot wraparound math). Do not restyle, re-scope, "clean
up", or add drag/real-media support to any other widget in this panel
without an explicit user request naming this feature.

# More than one agent works in this repo

Sessions run in parallel here and have already collided twice: a commit picked
up another session's edited file while the new module it imported was still
untracked, which broke the production build; and a control was nearly added
back to a row another session had just consolidated.

- Commit your own work before you stop. Never leave an edited file staged for
  someone else to sweep up, and never commit a file that imports something you
  have not committed.
- `git status` before you start. Files you did not touch may already be
  modified — read them before assuming what they contain.
- If a build error names a module you did not write, check whether the file
  exists on disk but is untracked (`git status`), not just whether the import
  path is correct.

# Prompt-bar keyboard system — built, do not break

`/image` and `/generate` share one keyboard and focus system for their prompt
bars. Read these before touching the files below.

    src/hooks/useListboxNav.ts   — navigation inside an open panel
    src/hooks/useToolbarNav.ts   — left/right movement across a control row
    src/app/globals.css          — .hide-scrollbar, .prompt-control-row :focus-visible

**Option panels** (ratio, resolution, quality, thinking, grid): up/down clamp at
the ends rather than wrapping; Home/End jump; Enter and Space select; Escape
restores whatever was selected when the panel opened. Selection follows focus —
the fill, the checkmark and the trigger label move together.

**Model lists**: the orange bar, orange card and checkmark follow focus, but the
model itself changes only on Enter or click. Committing on every arrow press
would reset aspect ratio, quality, count and the rest on each keystroke. The
search box keeps focus on open so typing still works; ArrowDown hands off into
the list.

**Control rows**: left/right move between controls, ArrowDown opens the focused
control's panel. The listener is bound to `.prompt-control-row`, never to the
document — the prompt editor is a sibling of that row, so typing keeps its own
caret behaviour, and portalled popovers keep their own up/down keys.

**Focus edge**: `.prompt-control-row :focus-visible` gives the focused control
the same thin orange border hovering produces. It is keyed to `:focus-visible`,
not `:focus`, so a mouse click never leaves a control lit.

**No glows**: controls and option rows carry no orange or white `box-shadow` or
`drop-shadow`. The outer prompt-panel borders and the Generate buttons keep
theirs — those are deliberate.

**Scrolling**: option lists hide their scrollbar through `.hide-scrollbar` and
stay scrollable. Ratio panels are capped above the longest list so they do not
scroll at all, because scrolling made the list jump on every arrow press.

Adding a control or an option needs no extra wiring — the hooks read their
counts from the same arrays the panels render.
