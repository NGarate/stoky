"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UploadZone } from "@/components/receipt/UploadZone";
import { ReceiptStatusBadge } from "@/components/receipt/ReceiptStatus";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";

export default function UploadPage() {
  const t = useTranslations("receipts");
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedReceiptId, setUploadedReceiptId] = useState<string | null>(null);

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
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(",")[1];
        const result = await uploadMutation.mutateAsync({
          fileBase64: base64,
          mimeType: file.type,
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
