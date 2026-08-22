"use client";

import { useState } from "react";
import { BackLink } from "@/components/ui/back-link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BarcodeScanner } from "@/components/barcode/Scanner";
import { useSnackbar } from "@/components/ui/snackbar";
import { api } from "@/lib/trpc/client";

export default function ScanPage() {
  const t = useTranslations("products.scan");
  const router = useRouter();
  const snackbar = useSnackbar();
  const [isScanning, setIsScanning] = useState(true);
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const scanMutation = api.product.scanBarcode.useMutation({
    onSuccess: (result) => {
      setIsProcessing(false);

      if (result.product) {
        // Arriving at the product is not the whole answer. Whether the scan
        // *found* it or *created* it is the one thing the destination cannot
        // show — the page looks identical either way — and it is what decides
        // whether the details on it were typed by this household or came from
        // a stranger's database.
        //
        // `?new=true` used to carry that distinction and nothing ever read it.
        snackbar.show({
          kind: "confirm",
          message: {
            key:
              result.source === "local"
                ? "products.scan.foundExisting"
                : "products.scan.createdFromLookup",
            values: { name: result.product.name },
          },
        });
        router.push(`/products/${result.product.id}`);
      } else {
        // Not found anywhere: the create form opens with the barcode filled
        // in, which is itself the answer and needs no sentence.
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
        <h1 className="text-2xl font-bold text-heading">{t("title")}</h1>
        <BackLink href="/products">{t("backToProducts")}</BackLink>
      </div>

      {isProcessing ? (
        <div className="p-8 bg-muted rounded-lg text-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-lg font-medium">{t("processing")}</p>
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
                {t("scanAgain")}
              </button>
            </div>
          )}

          <div className="mt-8 p-4 bg-muted rounded-lg">
            <h2 className="font-semibold mb-2 text-heading">{t("manualTitle")}</h2>
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
                placeholder={t("manualPlaceholder")}
                className="flex-1 px-4 py-2 rounded border border-input bg-card text-foreground"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded border border-input bg-card text-foreground hover:bg-accent hover:text-accent-foreground"
              >
                {t("manualSubmit")}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
