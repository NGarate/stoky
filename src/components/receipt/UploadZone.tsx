"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useTranslations } from "next-intl";
import { Upload, Camera, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { RECEIPT_IMAGE_TYPES } from "@/lib/validations/receipt";

interface UploadZoneProps {
  onUpload: (file: File) => void;
  isUploading?: boolean;
}

export function UploadZone({ onUpload, isUploading }: UploadZoneProps) {
  const t = useTranslations("receipts");
  const [preview, setPreview] = useState<string | null>(null);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setPreview(reader.result as string);
        };
        reader.readAsDataURL(file);
        onUpload(file);
      }
    },
    [onUpload],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    // Types, not extensions, and the server's own list.
    //
    // This becomes the `accept` attribute, which on Android decides which of
    // the phone's photos can be chosen at all. It listed `.jpg`, `.png` and
    // `.webp` beside the same three MIME types; Android reasons about types
    // rather than extensions, so they said nothing the types did not.
    //
    // Read from `RECEIPT_IMAGE_TYPES` rather than written out again: the
    // router refuses anything outside it, and offering a type the server
    // refuses is a failure after the choosing rather than before it. That
    // file also records why HEIC is not on it.
    accept: Object.fromEntries(
      RECEIPT_IMAGE_TYPES.map((type) => [type, [] as string[]]),
    ),
    maxFiles: 1,
    disabled: isUploading,
  });

  const handleCameraCapture = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setPreview(reader.result as string);
        };
        reader.readAsDataURL(file);
        onUpload(file);
      }
    };
    input.click();
  };

  const clearPreview = () => {
    setPreview(null);
  };

  return (
    <div className="space-y-4">
      {preview ? (
        <div className="relative">
          <img
            src={preview}
            alt={t("previewAlt")}
            className="w-full h-64 object-contain rounded-lg border border-border"
          />
          <button
            type="button"
            aria-label={t("clearPreview")}
            onClick={clearPreview}
            className="absolute top-2 right-2 p-1 bg-destructive text-destructive-foreground rounded-full hover:bg-destructive/90"
            disabled={isUploading}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div
          {...getRootProps()}
          className={cn(
            "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
            isDragActive
              ? "border-primary bg-accent"
              : "border-border bg-card hover:border-input",
            isUploading && "opacity-50 cursor-not-allowed",
          )}
        >
          {/* react-dropzone renders a visually hidden file input. Without an
              accessible name a screen-reader user hears only "file upload
              button" with no indication of what it takes — axe flags it as a
              critical `label` violation. */}
          <input {...getInputProps({ "aria-label": t("dropzoneLabel") })} />
          <div className="space-y-4">
            <div className="flex justify-center">
              <Upload className="w-12 h-12 text-muted-foreground" />
            </div>
            <p className="text-foreground">
              {isDragActive ? t("dropActive") : t("dropPrompt")}
            </p>
            <p className="text-sm text-muted-foreground">{t("dropHint")}</p>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleCameraCapture}
        disabled={isUploading}
        className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg border border-input bg-card text-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
      >
        <Camera className="w-5 h-5" />
        <span>{t("cameraCapture")}</span>
      </button>
    </div>
  );
}
