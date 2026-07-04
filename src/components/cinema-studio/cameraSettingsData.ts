export interface CameraSettingItem {
  label: string;
  type: "auto-svg" | "image" | "text";
  src?: string;
  svg?: string;
}

export const cameraColumn: CameraSettingItem[] = [
  { label: "Auto", type: "auto-svg", svg: "camera" },
  {
    label: "Raw 16mm",
    type: "image",
    src: "/assets/higgsfield/generate/cinematic_studio_35_camera_settings/a13b9c1f-d09f-4240-9a5c-d0708cf21ca6.webp"
  },
  {
    label: "Fine Film",
    type: "image",
    src: "/assets/higgsfield/generate/cinematic_studio_35_camera_settings/3a193c80-ec0e-45e0-87e8-a139962cf1d9.webp"
  },
  {
    label: "Clean Digital",
    type: "image",
    src: "/assets/higgsfield/generate/cinematic_studio_35_camera_settings/41cc8441-f705-442b-9d80-523b5b328b08.webp"
  }
];

export const lensColumn: CameraSettingItem[] = [
  { label: "Auto", type: "auto-svg", svg: "lens" },
  {
    label: "Clinical Sharp",
    type: "image",
    src: "/assets/higgsfield/generate/cinematic_studio_35_camera_settings/d0979de4-a23f-48b8-8470-f780718bbe6b.webp"
  },
  {
    label: "Extreme Macro",
    type: "image",
    src: "/assets/higgsfield/generate/cinematic_studio_35_camera_settings/46e7a3e7-373a-43c7-86ea-5723c7fd182a.webp"
  },
  {
    label: "Anamorphic",
    type: "image",
    src: "/assets/higgsfield/generate/cinematic_studio_35_camera_settings/9fdbe51a-e368-48c3-aa8b-37f22d84fc77.webp"
  },
  {
    label: "Warm Halation",
    type: "image",
    src: "/assets/higgsfield/generate/cinematic_studio_35_camera_settings/bd39bfa7-45fc-49e6-9542-a9ee45528234.webp"
  },
  {
    label: "Vintage Haze",
    type: "image",
    src: "/assets/higgsfield/generate/cinematic_studio_35_camera_settings/6210e973-58a5-4add-855f-5bd88c42119c.webp"
  }
];

export const focalLengthColumn: CameraSettingItem[] = [
  { label: "Auto", type: "auto-svg", svg: "focal" },
  { label: "75", type: "text" },
  { label: "50", type: "text" },
  { label: "35", type: "text" },
  { label: "14", type: "text" },
  { label: "8", type: "text" }
];

export const apertureColumn: CameraSettingItem[] = [
  { label: "Auto", type: "auto-svg", svg: "aperture" },
  {
    label: "f/11 Deep Focus",
    type: "image",
    src: "/assets/higgsfield/generate/cinematic_studio_35_camera_settings/8fe7aebc-2df1-4f5d-86e8-2aac8f6e3388.webp"
  },
  {
    label: "f/1.4 Wide Open",
    type: "image",
    src: "/assets/higgsfield/generate/cinematic_studio_35_camera_settings/132a90aa-5ab1-484e-ab3e-5df9e681bc4f.webp"
  },
  {
    label: "f/4 Moderate",
    type: "image",
    src: "/assets/higgsfield/generate/cinematic_studio_35_camera_settings/f32d4fc9-38dd-4c22-919b-bafaaea86877.webp"
  }
];
