Motion library clips
====================

The Motion / Character dialog on /generate (Kling Motion Control) renders one
tile per entry in src/components/cinema-studio/motionLibraryPresets.ts. Each
tile looks for a file here named after its id:

    public/motion-library/<id>.mp4      the clip itself
    public/motion-library/<id>.webp     optional poster frame

A tile with no file still renders — it falls back to a placeholder — so the
grid is complete whether or not the clips are present. Drop your own clips in
with the matching names and they play.
