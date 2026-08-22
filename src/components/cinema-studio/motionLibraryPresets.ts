/**
 * Motion library tiles, in the reference's own order.
 *
 * `id` doubles as the file name the tile looks for under
 * `public/motion-library/` — `<id>.mp4` for the clip, `<id>.webp` for an
 * optional poster. A tile whose file is missing still renders; it just shows
 * its placeholder instead of a video, so the grid is always complete.
 *
 * `ratio` is width/height. The reference uses two: most tiles are 0.553506,
 * and its three "preset" tiles are very slightly wider at 0.562852.
 */
export interface MotionPreset {
  id: string;
  label: string;
  ratio: number;
}

const R = 0.553506;
const R_WIDE = 0.562852;

export const MOTION_LIBRARY_PRESETS: MotionPreset[] = [
  { id: "motion-01", label: "1", ratio: R },
  { id: "motion-21", label: "21", ratio: R },
  { id: "motion-03", label: "3", ratio: R },
  { id: "motion-22", label: "22", ratio: R },
  { id: "motion-06", label: "6", ratio: R },
  { id: "motion-08", label: "8", ratio: R },
  { id: "motion-27", label: "27", ratio: R },
  { id: "motion-05", label: "5", ratio: R },
  { id: "motion-26", label: "26", ratio: R },
  { id: "motion-09", label: "9", ratio: R },
  { id: "motion-02", label: "2", ratio: R },
  { id: "motion-24", label: "24", ratio: R },
  { id: "motion-04", label: "4", ratio: R },
  { id: "motion-23", label: "23", ratio: R },
  { id: "motion-19", label: "19", ratio: R },
  { id: "motion-10", label: "10", ratio: R },
  { id: "motion-28", label: "28", ratio: R },
  { id: "motion-11", label: "11", ratio: R },
  { id: "motion-25", label: "25", ratio: R },
  { id: "motion-17", label: "17", ratio: R },
  { id: "motion-12", label: "12", ratio: R },
  { id: "motion-13", label: "13", ratio: R },
  { id: "motion-07", label: "7", ratio: R },
  { id: "preset-1", label: "preset 1", ratio: R_WIDE },
  { id: "motion-14", label: "14", ratio: R },
  { id: "motion-15", label: "15", ratio: R },
  { id: "motion-16", label: "16", ratio: R },
  { id: "motion-20", label: "20", ratio: R_WIDE },
  { id: "motion-18", label: "18", ratio: R },
  { id: "preset-2", label: "preset 2", ratio: R_WIDE },
  { id: "motion-29", label: "29", ratio: R },
  { id: "motion-30", label: "30", ratio: R },
  { id: "motion-31", label: "31", ratio: R },
  { id: "motion-32", label: "32", ratio: R },
  { id: "motion-33", label: "33", ratio: R },
  { id: "motion-34", label: "34", ratio: R },
];
