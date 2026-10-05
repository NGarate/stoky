"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useTranslations } from "next-intl";
import { Upload, Camera, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MAX_RECEIPT_BYTES, RECEIPT_IMAGE_TYPES } from "@/lib/validations/receipt";

interface UploadZoneProps {
  onUpload: (file: File) => void;
  isUploading?: boolean;
}

/** Bytes as the megabytes a person recognises, to one decimal. */
function inMegabytes(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

export function UploadZone({ onUpload, isUploading }: UploadZoneProps) {
  const t = useTranslations("receipts");
  const [preview, setPreview] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState<number | null>(null);

  /**
   * The one place a chosen file is accepted, whichever way it was chosen.
   *
   * **The size is refused here rather than by the server, because the server
   * cannot answer.** The photograph is base64'd into the request body — four
   * bytes for every three — and Next truncates a body over
   * `experimental.proxyClientMaxBodySize` before any procedure reads it. What
   * comes back is `JSON Parse error: Unterminated string`, which tells somebody
   * holding a phone nothing at all. The server's own check still exists and
   * still refuses; it just has no way to be the thing that explains it.
   *
   * Nothing is previewed and `onUpload` is not called, so a refused photograph
   * costs no encode and no request.
   */
  const accept = useCallback(
    (file: File) => {
      if (file.size > MAX_RECEIPT_BYTES) {
        setTooLarge(file.size);
        setPreview(null);
        return;
      }

      setTooLarge(null);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      onUpload(file);
    },
    [onUpload],
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (file) accept(file);
    },
    [accept],
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
      // Through the same gate as the dropzone. It used to repeat the read, the
      // preview and the call, which is how a check added to one path misses the
      // other — and this is the path a phone actually uses.
      if (file) accept(file);
    };
    input.click();
  };

  const clearPreview = () => {
    setPreview(null);
  };

  return (
    <div className="space-y-4">
      {/* Rendered whether or not it has anything to say, and `sr-only` when it
          does not. A live region inserted at the moment it speaks is the case
          screen readers may skip (WCAG 4.1.3) — the login form learned that the
          hard way and this follows it, including `role="status"` as the
          fallback role. Polite, because `SyncStatus` owns the one assertive
          region in this application. */}
      <p
        aria-live="polite"
        className={
          tooLarge === null
            ? "sr-only"
            : "rounded-xl border border-danger-foreground bg-danger px-4 py-3 text-sm text-danger-foreground"
        }
        role="status"
      >
        {tooLarge === null
          ? ""
          : t("uploadTooLarge", {
              size: inMegabytes(tooLarge),
              max: inMegabytes(MAX_RECEIPT_BYTES),
            })}
      </p>

      {preview ? (
        <div className="relative">
          <img
            src={preview}
            alt={t("previewAlt")}
            className="w-full h-64 object-contain rounded-lg border border-border"
          />
          {/* The icon primitive: a hand-styled 24px circle was half the
              target floor, on the one control that throws the photo away. */}
          <Button
            type="button"
            aria-label={t("clearPreview")}
            onClick={clearPreview}
            className="absolute top-2 right-2 rounded-full"
            disabled={isUploading}
            size="icon"
            variant="destructive"
          >
            <X aria-hidden="true" className="w-4 h-4" />
          </Button>
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
