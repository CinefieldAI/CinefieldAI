export interface GenrePreset {
  label: string;
  src: string;
}

export const genrePresets: GenrePreset[] = [
  {
    label: "General",
    src: "/assets/higgsfield/generate/cinema-genres/general.mp4"
  },
  {
    label: "Action",
    src: "/assets/higgsfield/generate/cinema-genres/Action.mp4"
  },
  {
    label: "Horror",
    src: "/assets/higgsfield/generate/cinema-genres/HOROR.mp4"
  },
  {
    label: "Comedy",
    src: "/assets/higgsfield/generate/cinema-genres/Comedy.mp4"
  },
  {
    label: "Noir",
    src: "/assets/higgsfield/generate/cinema-genres/noir.mp4"
  },
  {
    label: "Drama",
    src: "/assets/higgsfield/generate/cinema-genres/Intimate%25201.mp4"
  },
  {
    label: "Epic",
    src: "/assets/higgsfield/generate/cinema-genres/epic.mp4"
  }
];

export const DEFAULT_GENRE = "Action";
