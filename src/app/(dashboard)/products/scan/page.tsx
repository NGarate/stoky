"use client";

import { useState } from "react";
import { onlineManager } from "@tanstack/react-query";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { sectionHeading } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BarcodeScanner } from "@/components/barcode/Scanner";
import { useSnackbar } from "@/components/ui/snackbar";
import { api } from "@/lib/trpc/client";
import { invalidateAfterProductCreated } from "@/lib/trpc/stale";
import { useWriteQueue } from "@/lib/offline/queue-context";
import { httpStatusOf } from "@/lib/offline/classify";

export default function ScanPage() {
  const t = useTranslations("products.scan");
  const router = useRouter();
  const snackbar = useSnackbar();
  const utils = api.useUtils();
  const { state: queueState, enqueue } = useWriteQueue();
  const [isScanning, setIsScanning] = useState(true);
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  /**
   * Queue the scan instead of sending it — the offline path (T7).
   *
   * Returns whether it was queued, so the caller can fall back to it from
   * `onError` too: a captive portal answers `online` and then fails the
   * request with no status, which `onlineManager` cannot see in advance.
   * Deduped against what is already waiting, because scanning the same code
   * twice while offline is a double-tap, not two intentions.
   */
  function queueScan(barcode: string): boolean {
    const already = queueState.pending.some(
      (op) => op.path === "product.resolveScan" && op.input.barcode === barcode,
    );
    if (already) {
      snackbar.show({
        kind: "confirm",
        message: { key: "products.scan.alreadyQueued", values: { barcode } },
      });
      return true;
    }

    const queued = enqueue({
      path: "product.resolveScan",
      input: { barcode },
      label: { key: "offline.scannedBarcode", values: { barcode } },
    });
    if (!queued.ok) return false;

    snackbar.show({
      kind: "confirm",
      message: { key: "products.scan.queuedOffline", values: { barcode } },
    });
    return true;
  }

  const scanMutation = api.product.scanBarcode.useMutation({
    onSuccess: (result, variables) => {
      setIsProcessing(false);

      // A lookup that found the code elsewhere *created* the product, and the
      // catalogue was still the list from before it existed.
      if (result.product && result.source !== "local") {
        void invalidateAfterProductCreated(utils);
      }

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
        //
        // Encoded, and taken from what was sent rather than from state. The
        // manual field accepts anything, so "12&pendingScan=x" became a
        // second query parameter — and a `#` cut the code short.
        router.push(
          `/products/new?barcode=${encodeURIComponent(variables.barcode)}`,
        );
      }
    },
    onError: (error) => {
      setIsProcessing(false);
      // A transport failure with no status is a captive portal or a dropped
      // connection — `onlineManager` said online but nothing got through. Queue
      // it rather than lose the scan; a real server error (a status) is a
      // genuine failure and falls through to scanning again.
      if (scannedBarcode && httpStatusOf(error) === null) {
        queueScan(scannedBarcode);
        setScannedBarcode(null);
      }
      setIsScanning(true);
    },
  });

  const handleScan = (barcode: string) => {
    if (isProcessing) return;

    setScannedBarcode(barcode);
    setIsScanning(false);

    // Offline mutations pause rather than error under TanStack Query's default
    // networkMode, so `onError` never fires — the scan would hang. Check first
    // and queue, which is the whole of T7's happy path.
    if (!onlineManager.isOnline()) {
      queueScan(barcode);
      setScannedBarcode(null);
      setIsScanning(true);
      return;
    }

    setIsProcessing(true);
    scanMutation.mutate({ barcode });
  };

  const handleError = (error: Error) => {
    console.error("Scan error:", error);
    setIsScanning(false);
  };

  return (
    // No padding of its own: the layout's `p-4` is the gutter, and a second
    // `p-6` cost 48px of a 390px screen (ISSUES UI-5).
    <PageShell width="form">
      <PageHeader
        back={{ href: "/products", label: t("backToProducts") }}
        title={t("title")}
      />

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

          {/* `Button`, not a hand-styled <button>: the primitive is what
              clears the 48px floor, and these two were 40px tall. */}
          {!isScanning && (
            <div className="mt-4 text-center">
              <Button
                type="button"
                onClick={() => {
                  setIsScanning(true);
                  setScannedBarcode(null);
                }}
              >
                {t("scanAgain")}
              </Button>
            </div>
          )}

          <div className="mt-8 p-4 bg-muted rounded-lg">
            <h2 className={`mb-2 ${sectionHeading()}`}>{t("manualTitle")}</h2>
            {/* A label, not only a placeholder: the placeholder is gone the
                moment somebody types, and with it the field's only name. */}
            <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="manual-barcode">
              {t("manualLabel")}
            </label>
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
              <Input
                className="flex-1"
                id="manual-barcode"
                name="barcode"
                placeholder={t("manualPlaceholder")}
                type="text"
              />
              <Button type="submit" variant="outline">
                {t("manualSubmit")}
              </Button>
            </form>
          </div>
        </>
      )}
    </PageShell>
  );
}
