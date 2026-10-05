"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UploadZone } from "@/components/receipt/UploadZone";
import { StoreSelector } from "@/components/store/StoreSelector";
import { ReceiptStatusBadge } from "@/components/receipt/ReceiptStatus";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { useSnackbar } from "@/components/ui/snackbar";

/**
 * `FileReader` as a promise.
 *
 * It is a callback API, and awaiting the upload *inside* `onloadend` puts the
 * await in a different call stack from the `try` around it — so a rejected
 * upload was an unhandled rejection rather than a caught error, and the
 * failure branch could never run. The same shape made `finally` fire while the
 * file was still being read.
 */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("The file could not be read"));
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

export default function UploadPage() {
  const t = useTranslations("receipts");
  const snackbar = useSnackbar();
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedReceiptId, setUploadedReceiptId] = useState<string | null>(null);
  // "No store means no prices": applyReceipt writes a PriceRecord per line
  // only when the receipt has a store, and until Phase 8 no screen ever sent
  // one — the second half of ISSUES.md PRICE-1.
  const [storeId, setStoreId] = useState("");

  const uploadMutation = api.receipt.upload.useMutation();
  const statusQuery = api.receipt.getStatus.useQuery(
    { receiptId: uploadedReceiptId ?? "" },
    {
      enabled: !!uploadedReceiptId,
      refetchInterval: (query) => {
        const data = query?.state?.data;
        if (
          data?.status === "UPLOADING" ||
          data?.status === "PROCESSING" ||
          data?.status === "PARSED"
        ) {
          return 1000;
        }
        return false;
      },
    },
  );

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    // The React Compiler cannot yet memoise a component containing this
    // `try`/`catch` around an await, so it declines to optimise the whole
    // component. A tool limitation rather than a defect: the handler is
    // correct, and the cost is a missed memoisation on a screen that renders a
    // form. Revisit when babel-plugin-react-compiler supports it.
    // react-doctor-disable-next-line react-hooks-js/todo
    try {
      const dataUrl = await readAsDataUrl(file);
      const base64 = dataUrl.split(",")[1];
      const result = await uploadMutation.mutateAsync({
        fileBase64: base64,
        mimeType: file.type,
        ...(storeId !== "" ? { storeId } : {}),
      });
      setUploadedReceiptId(result.id);
    } catch (error) {
      console.error("Upload failed:", error);
      // Was `alert()`: a modal that stops the page, cannot be styled, cannot
      // be translated by anything but its message, and is the one piece of
      // feedback in this application a screen reader announces as a browser
      // dialog rather than as part of the page.
      snackbar.show({
        kind: "confirm",
        message: { key: "receipts.uploadError" },
        tone: "danger",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleContinue = () => {
    if (uploadedReceiptId) {
      router.push(`/receipts/${uploadedReceiptId}/review`);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6 text-heading">{t("upload")}</h1>

      {!uploadedReceiptId ? (
        <div className="space-y-6">
          <div>
            <label
              htmlFor="receipt-store"
              className="mb-1 block text-sm font-medium text-foreground"
            >
              {t("uploadStoreLabel")}
            </label>
            <StoreSelector
              id="receipt-store"
              value={storeId}
              onChange={setStoreId}
            />
            <p className="mt-1 text-sm text-muted-foreground">
              {t("uploadStoreHint")}
            </p>
          </div>

          <UploadZone onUpload={handleUpload} isUploading={isUploading} />

          {isUploading && (
            <p className="text-center text-muted-foreground">{t("uploadingHint")}</p>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {statusQuery.data && (
            <>
              <ReceiptStatusBadge
                status={statusQuery.data.status}
                progress={statusQuery.data.progress}
              />

              {statusQuery.data.status === "FAILED" && (
                <div className="rounded-lg border border-danger-foreground bg-danger p-4">
                  <p className="text-danger-foreground">{t("processingFailed")}</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2"
                    onClick={() => setUploadedReceiptId(null)}
                  >
                    {t("retry")}
                  </Button>
                </div>
              )}

              {(statusQuery.data.status === "NEEDS_REVIEW" ||
                statusQuery.data.status === "CONFIRMED") && (
                <div className="text-center">
                  <p className="text-ok-foreground mb-4">
                    {t("processed", {
                      count: statusQuery.data.progress?.processed || 0,
                    })}
                  </p>
                  <Button type="button" onClick={handleContinue}>
                    {t("reviewItems")}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
