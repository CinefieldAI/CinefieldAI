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

**Cinema Studio 4.0 is FULLY LOCKED as of commit `e9e1dcf` (2026-08-16).**
The model entry in `cinemaStudioData.ts` (id `cinema-studio-4.0`), the
`CinemaStudio40CreativeControls.tsx` component (the References/Film
setup/Camera/Color palette/Lighting pill row and its four dialogs), and
every `isCinema40`-gated block in `CinemaStudioWorkspace.tsx` and
`PromptBar.tsx` are frozen at that commit. First built at `879400d` from a
prose description; then fully rewritten at `e9e1dcf` against the reference's
actual DOM markup (Genre arc, Era ruler, Tempo carousel, Camera Setup
wheels, Movement grid, Color palette grid, Lighting grid all use its real
geometry/formulas/option lists — none of it invented). All option arrays
now live in `cinemaStudioData.ts` as `CINEMA40_*` (no longer sharing the
generic `GENRES`/`COLOR_PALETTES`/`LIGHTING`). Colour tokens and the accent
(#D97757) are this project's own, not the reference's; the reference's real
photography/video was deliberately not downloaded — gradient swatches stand
in. Pointer-drag on the arc/ruler/carousel/wheels is not implemented yet
(Prev/Next click stepping works). Do not restyle, re-scope, "clean up", or
add drag/real-media support without an explicit user request naming this
feature.

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
