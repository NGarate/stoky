"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BarcodeScanner } from "@/components/barcode/Scanner";
import { api } from "@/lib/trpc/client";

export default function ScanPage() {
  const router = useRouter();
  const [isScanning, setIsScanning] = useState(true);
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const scanMutation = api.product.scanBarcode.useMutation({
    onSuccess: (result) => {
      setIsProcessing(false);

      if (result.product) {
        if (result.source === "local") {
          // Product already exists, navigate to it
          router.push(`/products/${result.product.id}`);
        } else {
          // Product created from Open Food Facts
          router.push(`/products/${result.product.id}?new=true`);
        }
      } else {
        // Product not found, redirect to create page with barcode
        router.push(`/products/new?barcode=${scannedBarcode}`);
      }
    },
    onError: () => {
      setIsProcessing(false);
      setIsScanning(true);
    },
  });

  const handleScan = (barcode: string) => {
    if (isProcessing) return;

    setScannedBarcode(barcode);
    setIsScanning(false);
    setIsProcessing(true);

    scanMutation.mutate({ barcode });
  };

  const handleError = (error: Error) => {
    console.error("Scan error:", error);
    setIsScanning(false);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-heading">Escanear Código de Barras</h1>
        <Link
          href="/products"
          className="text-primary hover:underline"
        >
          ← Volver a productos
        </Link>
      </div>

      {isProcessing ? (
        <div className="p-8 bg-muted rounded-lg text-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-lg font-medium">Procesando código...</p>
          <p className="text-muted-foreground">{scannedBarcode}</p>
        </div>
      ) : (
        <>
          <BarcodeScanner
            onScan={handleScan}
            onError={handleError}
            isScanning={isScanning}
          />

          {!isScanning && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => {
                  setIsScanning(true);
                  setScannedBarcode(null);
                }}
                className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
              >
                Escanear otro código
              </button>
            </div>
          )}

          <div className="mt-8 p-4 bg-muted rounded-lg">
            <h2 className="font-semibold mb-2 text-heading">Código manual</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const input = e.currentTarget.elements.namedItem(
                  "barcode"
                ) as HTMLInputElement;
                if (input.value) {
                  handleScan(input.value);
                }
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                name="barcode"
                placeholder="Introducir código manualmente"
                className="flex-1 px-4 py-2 rounded border border-input bg-card text-foreground"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded border border-input bg-card text-foreground hover:bg-accent hover:text-accent-foreground"
              >
                Buscar
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
