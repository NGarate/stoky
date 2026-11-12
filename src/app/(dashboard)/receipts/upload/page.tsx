"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { UploadZone } from "@/components/receipt/UploadZone";
import { ReceiptPhoto } from "@/components/receipt/ReceiptPhoto";
import { ReceiptStatusBadge } from "@/components/receipt/ReceiptStatus";
import { api } from "@/lib/trpc/client";
import type { Quad } from "@/lib/receipt-quad";
import { Button } from "@/components/ui/button";
import { Combobox, foldText } from "@/components/ui/combobox";
import { PageHeader, PageShell } from "@/components/ui/page-header";
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

/**
 * `useSearchParams` opts the subtree out of static rendering, so it sits
 * under a Suspense boundary, as on /inventory.
 */
export default function UploadPage() {
  return (
    <Suspense fallback={null}>
      <UploadView />
    </Suspense>
  );
}

/** Where the upload screen follows the receipt it sent, `?receipt=<id>`. */
const UPLOAD_PATH = "/receipts/upload";

function UploadView() {
  const t = useTranslations("receipts");
  const snackbar = useSnackbar();
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  // In the address, not in React state. Held in state, a reload while the
  // photo was being read — or the page being dropped from memory on a phone —
  // put the person back in front of an empty form, with no word of the
  // receipt they had just sent.
  const uploadedReceiptId = useSearchParams().get("receipt");
  const setUploadedReceiptId = (id: string | null) =>
    router.replace(id ? `${UPLOAD_PATH}?receipt=${id}` : UPLOAD_PATH);
  const utils = api.useUtils();
  // "No store means no prices": applyReceipt writes a PriceRecord per line
  // only when the receipt has a store, and until Phase 8 no screen ever sent
  // one — the second half of ISSUES.md PRICE-1.
  //
  // Typed rather than picked: a shop the household has not used yet is named
  // here and created with the receipt, instead of sending the person to
  // Settings first — where, unless they administer the household, they could
  // not add it anyway.
  const [storeText, setStoreText] = useState("");
  const stores = api.store.list.useQuery({ limit: 100 });
  const typedStore = storeText.trim();
  // Matched as the suggestions are, so the shop the panel marks as chosen is
  // the one the receipt is filed under.
  const pickedStore =
    typedStore === ""
      ? undefined
      : stores.data?.find(
          (store) => foldText(store.name) === foldText(typedStore),
        );
  const newStoreName = typedStore !== "" && !pickedStore ? typedStore : null;

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

  const handleUpload = async (file: File, quad?: Quad) => {
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
        ...(quad && { quad }),
        ...(pickedStore
          ? { storeId: pickedStore.id }
          : newStoreName
            ? { storeName: newStoreName }
            : {}),
      });
      if (newStoreName) await utils.store.list.invalidate();
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

  const status = statusQuery.data?.status;
  const failed = status === "FAILED";
  const ready = status === "NEEDS_REVIEW" || status === "CONFIRMED";
  const processed = t("processed", {
    count: statusQuery.data?.progress?.processed || 0,
  });

  const handleContinue = () => {
    if (uploadedReceiptId) {
      router.push(`/receipts/${uploadedReceiptId}/review`);
    }
  };

  // Read, so on to what was read. Replaced rather than pushed: back from the
  // review is the list, not a screen saying the wait is over.
  //
  // The review is marked stale first. A receipt read again (`reframe`) has
  // one cached from before, and fresh for 30 s: fetched while its lines were
  // gone and the reading had just begun, it opened with no line and no shop
  // — what the owner saw on 2026-11-12, with twelve lines in the database.
  useEffect(() => {
    if (ready && uploadedReceiptId) {
      void utils.receipt.getReceiptWithItems.invalidate({
        receiptId: uploadedReceiptId,
      });
      router.replace(`/receipts/${uploadedReceiptId}/review`);
    }
  }, [ready, uploadedReceiptId, router, utils]);

  return (
    // No padding of its own: the layout's `p-4` is the gutter (ISSUES UI-5).
    // And a way back, which this was the one sub-page without — the list it
    // came from was reachable only through the navigation.
    <PageShell width="form">
      <PageHeader back="/receipts" title={t("upload")} />

      {!uploadedReceiptId ? (
        <div className="space-y-6">
          <div>
            <label
              htmlFor="receipt-store"
              className="mb-1 block text-sm font-medium text-foreground"
            >
              {t("uploadStoreLabel")}
            </label>
            <Combobox
              id="receipt-store"
              aria-describedby="receipt-store-hint receipt-store-new"
              listLabel={t("uploadStoreList")}
              onValueChange={setStoreText}
              options={stores.data?.map((store) => store.name) ?? []}
              placeholder={t("uploadStorePlaceholder")}
              value={storeText}
            />
            <p
              id="receipt-store-hint"
              className="mt-1 text-sm text-muted-foreground"
            >
              {t("uploadStoreHint")}
            </p>
            {/* Always mounted, empty until there is something to say, so the
                sentence is announced when it appears. */}
            <p
              id="receipt-store-new"
              aria-live="polite"
              className="mt-1 text-sm text-foreground"
              role="status"
            >
              {newStoreName ? t("uploadStoreNew", { name: newStoreName }) : ""}
            </p>
          </div>

          <UploadZone onUpload={handleUpload} isUploading={isUploading} />

          {isUploading && (
            <p className="text-center text-muted-foreground">
              {t("uploadingHint")}
            </p>
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

              {/* What is being read, as the server stored it: a JPEG every
                  browser draws, where the phone's own HEIC was not. */}
              <ReceiptPhoto defaultOpen receiptId={uploadedReceiptId} />

              {failed && (
                <div className="rounded-lg border border-danger-foreground bg-danger p-4">
                  {/* The sentence is said by the region below; drawn here
                      beside the button that acts on it. */}
                  <p aria-hidden="true" className="text-danger-foreground">
                    {t("processingFailed")}
                  </p>
                  {/* Or keep this photo and type what it says: a failed
                      read is not a lost receipt (`receipt.addItem`). */}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setUploadedReceiptId(null)}
                    >
                      {t("retry")}
                    </Button>
                    <Button asChild variant="outline">
                      <Link href={`/receipts/${uploadedReceiptId}/review`}>
                        {t("line.byHand")}
                      </Link>
                    </Button>
                  </div>
                </div>
              )}

              {ready && (
                <div>
                  <p aria-hidden="true" className="mb-4 text-ok-foreground">
                    {processed}
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

      {/* How the wait ended, said once. The result used to appear in a
          plain block after seconds of nothing, so somebody looking elsewhere
          — or listening — was never told the wait was over (WCAG 4.1.3).
          Mounted from the first render and empty until there is something to
          say, because a region created at the moment it gains text is the
          one some readers skip. The visible copies above are aria-hidden so
          the sentence is not read twice. */}
      <p
        aria-live="polite"
        className="sr-only"
        data-slot="upload-result"
        role="status"
      >
        {failed ? t("processingFailed") : ready ? processed : ""}
      </p>
    </PageShell>
  );
}
