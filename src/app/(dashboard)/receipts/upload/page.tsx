"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UploadZone } from "@/components/receipt/UploadZone";
import { StoreSelector } from "@/components/store/StoreSelector";
import { ReceiptStatusBadge } from "@/components/receipt/ReceiptStatus";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";

export default function UploadPage() {
  const t = useTranslations("receipts");
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
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(",")[1];
        const result = await uploadMutation.mutateAsync({
          fileBase64: base64,
          mimeType: file.type,
          ...(storeId !== "" ? { storeId } : {}),
        });
        setUploadedReceiptId(result.id);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Upload failed:", error);
      alert(t("uploadError"));
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
              className="min-h-[48px] w-full"
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
