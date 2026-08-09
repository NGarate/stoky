"use client";

import { useState, useCallback, useEffect } from "react";
import { BarcodeScanner as BarcodeScannerComponent } from "@thewirv/react-barcode-scanner";

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onError?: (error: Error) => void;
  isScanning?: boolean;
}

export function BarcodeScanner({
  onScan,
  onError,
  isScanning = true,
}: BarcodeScannerProps) {
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const handleSuccess = useCallback(
    (barcode: string) => {
      onScan(barcode);
    },
    [onScan]
  );

  const handleError = useCallback(
    (error?: Error) => {
      const errMsg = error?.message || "Error desconocido";
      console.error("Barcode scanner error:", errMsg);
      setScanError(errMsg);
      if (error) {
        onError?.(error);
      }
    },
    [onError]
  );

  // Check if device has torch capability
  useEffect(() => {
    const checkTorch = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        const track = stream.getVideoTracks()[0];
        const capabilities = track.getCapabilities();
        setHasTorch("torch" in capabilities);
        for (const track of stream.getTracks()) {
          track.stop();
        }
      } catch {
        setHasTorch(false);
      }
    };

    checkTorch();
  }, []);

  if (!isScanning) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg bg-muted p-8">
        <p className="text-muted-foreground">Escáner desactivado</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative overflow-hidden rounded-lg aspect-[4/3] bg-black">
        <BarcodeScannerComponent
          doScan={isScanning}
          onSuccess={handleSuccess}
          onError={handleError}
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
            onClick={() => setTorchEnabled(!torchEnabled)}
            className="absolute bottom-4 right-4 p-2 bg-black/50 text-white rounded-full hover:bg-black/70 transition-colors"
            aria-label={
              torchEnabled ? "Apagar linterna" : "Encender linterna"
            }
            title={torchEnabled ? "Apagar linterna" : "Encender linterna"}
          >
            {torchEnabled ? (
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <title>Apagar linterna</title>
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
                <title>Encender linterna</title>
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

      {scanError && (
        <div className="mt-4 rounded border border-danger-foreground bg-danger p-4 text-danger-foreground">
          <p className="font-medium">Error al acceder a la cámara</p>
          <p className="text-sm">{scanError}</p>
          <p className="text-sm mt-2">
            Asegúrate de permitir el acceso a la cámara e intenta de nuevo.
          </p>
        </div>
      )}

      <p className="mt-4 text-center text-sm text-muted-foreground">
        Coloca el código de barras dentro del rectángulo verde
      </p>
    </div>
  );
}
