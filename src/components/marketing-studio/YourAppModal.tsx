"use client";

import { useState, useRef } from "react";
import { X, Upload } from "lucide-react";

interface YourAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateApp: (data: {
    mode: "web" | "mobile";
    screenshotFile: File | null;
    screenshotPreviewUrl: string;
    productName: string;
    description: string;
  }) => void;
}

export default function YourAppModal({
  isOpen,
  onClose,
  onCreateApp,
}: YourAppModalProps) {
  const [appUploadMode, setAppUploadMode] = useState<"web" | "mobile">("web");
  const [appScreenshot, setAppScreenshot] = useState<File | null>(null);
  const [appScreenshotPreview, setAppScreenshotPreview] = useState<string>("");
  const [appProductName, setAppProductName] = useState("");
  const [appDescription, setAppDescription] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAppScreenshot(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        setAppScreenshotPreview(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const isCreateDisabled = !appScreenshot || !appProductName.trim() || !appDescription.trim();

  const handleCreateApp = () => {
    if (isCreateDisabled) return;

    onCreateApp({
      mode: appUploadMode,
      screenshotFile: appScreenshot,
      screenshotPreviewUrl: appScreenshotPreview,
      productName: appProductName,
      description: appDescription,
    });
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[998] bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="fixed z-[1210] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(847px,calc(100vw-32px))] rounded-[28px] bg-[#1D1F21] text-white overflow-hidden"
        role="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h2 className="text-lg font-semibold">Your App</h2>
          <button
            onClick={onClose}
            className="flex size-8 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* BODY */}
        <div className="flex h-[calc(515px-60px)]">
          {/* LEFT: UPLOAD AREA */}
          <div className="shrink-0 w-[343px] flex flex-col p-6 border-r border-white/5">
            {/* Web/Mobile Toggle */}
            <div className="flex gap-1 mb-4 bg-black/40 rounded-[10px] p-1 w-fit">
              <button
                onClick={() => setAppUploadMode("web")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  appUploadMode === "web"
                    ? "bg-white/10 text-white"
                    : "text-white/50 hover:text-white"
                }`}
              >
                Web
              </button>
              <button
                onClick={() => setAppUploadMode("mobile")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  appUploadMode === "mobile"
                    ? "bg-white/10 text-white"
                    : "text-white/50 hover:text-white"
                }`}
              >
                Mobile
              </button>
            </div>

            {/* Upload Area */}
            <div className="flex-1 rounded-[20px] bg-white/5 border border-white/10 flex flex-col items-center justify-center overflow-hidden relative">
              {appScreenshotPreview ? (
                <img
                  src={appScreenshotPreview}
                  alt="App screenshot preview"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-center">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                  >
                    <Upload className="h-5 w-5 text-white/60" />
                  </button>
                  <p className="text-sm font-medium">Upload from device</p>
                  <p className="text-xs text-white/50">
                    {appUploadMode === "web"
                      ? "Screenshot of your web app"
                      : "Screenshot of your mobile app"}
                  </p>
                </div>
              )}

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleFileSelect}
                className="hidden"
                aria-label="Upload app screenshot"
              />

              {/* Click overlay for upload */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 cursor-pointer hover:bg-white/5 transition-colors"
              />
            </div>
          </div>

          {/* RIGHT: FORM AREA */}
          <div className="flex-1 flex flex-col p-6 gap-6">
            {/* Product Name */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-white/70">
                Product name
              </label>
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 h-11">
                <div className="w-6 h-6 rounded-lg bg-white/10" />
                <input
                  type="text"
                  value={appProductName}
                  onChange={(e) =>
                    setAppProductName(e.target.value.substring(0, 80))
                  }
                  placeholder="higgsfield.ai"
                  maxLength={80}
                  className="flex-1 bg-transparent text-sm text-white placeholder:text-white/50 outline-none"
                />
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2 flex-1 flex flex-col">
              <label className="text-xs font-semibold text-white/70">
                Description
              </label>
              <textarea
                value={appDescription}
                onChange={(e) =>
                  setAppDescription(e.target.value.substring(0, 500))
                }
                placeholder="Describe your app"
                maxLength={500}
                className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-white/50 outline-none resize-none focus:border-white/20 transition-colors"
              />
            </div>

            {/* Create App Button */}
            <button
              onClick={handleCreateApp}
              disabled={isCreateDisabled}
              className={`w-full h-10 rounded-xl font-semibold text-sm transition-colors ${
                isCreateDisabled
                  ? "bg-white/20 text-white/50 cursor-not-allowed"
                  : "bg-white text-black hover:bg-white/90"
              }`}
            >
              Create App
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
