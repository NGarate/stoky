"use client";

import { useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { BarcodeScanner as BarcodeScannerComponent } from "@thewirv/react-barcode-scanner";

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onError?: (error: Error) => void;
  isScanning?: boolean;
}

/**
 * `torch` is real and unlisted.
 *
 * It is in the MediaStream Image Capture spec as a settable constraint, it
 * works in Chromium on Android, and TypeScript's DOM library has never carried
 * it — `MediaTrackConstraintSet` has no `torch`. Widening the type rather than
 * casting past it keeps the rest of the constraint object checked, and the
 * widened type is still assignable to `MediaTrackConstraints`, so
 * `applyConstraints` takes it with no cast at all. Delete this the day lib.dom
 * grows the field.
 *
 * Safari does not implement it, which is why the control is offered only where
 * the track reports the capability rather than wherever a camera exists.
 */
interface TorchConstraints extends MediaTrackConstraints {
  advanced?: Array<MediaTrackConstraintSet & { torch?: boolean }>;
}

export function BarcodeScanner({
  onScan,
  onError,
  isScanning = true,
}: BarcodeScannerProps) {
  const t = useTranslations("products.scan");
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchFailed, setTorchFailed] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleSuccess = useCallback(
    (barcode: string) => {
      onScan(barcode);
    },
    [onScan]
  );

  const handleError = useCallback(
    (error?: Error) => {
      const errMsg = error?.message || t("cameraErrorUnknown");
      console.error("Barcode scanner error:", errMsg);
      setScanError(errMsg);
      if (error) {
        onError?.(error);
      }
    },
    [onError, t]
  );

  /**
   * The live camera track the scanner is decoding from, or null.
   *
   * Found through this component's own wrapper rather than a ref handed to the
   * library: it renders `<video ref={...} {...videoProps} />` with the spread
   * *after* its ref, so a ref passed in `videoProps` silently replaces the one
   * decoding depends on and the scanner stops reading barcodes.
   */
  const cameraTrack = useCallback((): MediaStreamTrack | null => {
    const video = containerRef.current?.querySelector("video");
    const stream = video?.srcObject as MediaStream | null | undefined;
    if (!stream || typeof stream.getVideoTracks !== "function") return null;
    return stream.getVideoTracks()[0] ?? null;
  }, []);

  /**
   * Whether this camera has a torch, asked of the track the button will act on.
   *
   * This used to open a *second* `getUserMedia` stream at mount purely to read
   * capabilities, and answer from that. Two problems, and ISSUES.md DEBT-2 is
   * the second: a device that allows only one camera stream at a time gets a
   * probe competing with the scanner's own, and the button's existence came
   * from one track while its effect was meant for another — so it could be
   * offered on a camera it could never reach. Deriving both from one track is
   * what stops the control lying.
   */
  const handleLoad = useCallback(() => {
    const track = cameraTrack();
    const capabilities = track?.getCapabilities?.() ?? {};
    setHasTorch("torch" in capabilities);
    // A freshly acquired track always has its torch off, so the label must
    // agree — otherwise resuming a scan shows "turn it off" over a dark lamp.
    setTorchEnabled(false);
    setTorchFailed(false);
  }, [cameraTrack]);

  const toggleTorch = useCallback(async () => {
    const track = cameraTrack();
    if (!track) return;

    const next = !torchEnabled;
    const constraints: TorchConstraints = { advanced: [{ torch: next }] };
    try {
      await track.applyConstraints(constraints);
      setTorchEnabled(next);
      setTorchFailed(false);
    } catch {
      // Say so rather than flipping the label over a lamp that did not come
      // on: REDESIGN_PLAN §7 rule 4, errors say what to do next.
      setTorchFailed(true);
    }
  }, [cameraTrack, torchEnabled]);

  if (!isScanning) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg bg-muted p-8">
        <p className="text-muted-foreground">{t("cameraOff")}</p>
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative overflow-hidden rounded-lg aspect-[4/3] bg-black">
        <BarcodeScannerComponent
          doScan={isScanning}
          onSuccess={handleSuccess}
          onError={handleError}
          onLoad={handleLoad}
        />

        {/* Overlay guides. Deliberately outside the token system: these sit
            on live camera output rather than a themed surface, so they are
            fixed black/white/green for legibility against any scene. */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-black/20" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-48 border-2 border-white/50 rounded-lg">
            <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-green-500 -translate-x-px -translate-y-px" />
            <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-green-500 translate-x-px -translate-y-px" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-green-500 -translate-x-px translate-y-px" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-green-500 translate-x-px translate-y-px" />
          </div>
        </div>

        {/* Torch toggle button */}
        {hasTorch && (
          <button
            type="button"
            onClick={() => void toggleTorch()}
            aria-pressed={torchEnabled}
            className="absolute bottom-4 right-4 p-2 bg-black/50 text-white rounded-full hover:bg-black/70 transition-colors"
            aria-label={
              torchEnabled ? t("torchOff") : t("torchOn")
            }
            title={torchEnabled ? t("torchOff") : t("torchOn")}
          >
            {torchEnabled ? (
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <title>{t("torchOff")}</title>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
            ) : (
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <title>{t("torchOn")}</title>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                />
              </svg>
            )}
          </button>
        )}
      </div>

      {torchFailed && (
        <p
          aria-live="polite"
          className="mt-4 rounded border border-warn-foreground bg-warn p-4 text-sm text-warn-foreground"
        >
          {t("torchFailed")}
        </p>
      )}

      {scanError && (
        <div className="mt-4 rounded border border-danger-foreground bg-danger p-4 text-danger-foreground">
          <p className="font-medium">{t("cameraErrorTitle")}</p>
          <p className="text-sm">{scanError}</p>
          <p className="text-sm mt-2">{t("cameraErrorHint")}</p>
        </div>
      )}

      <p className="mt-4 text-center text-sm text-muted-foreground">
        {t("framingHint")}
      </p>
    </div>
  );
}
