"use client";

import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { ScanLine } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScanProductDialog } from "@/components/barcode/ScanProductDialog";
import { api } from "@/lib/trpc/client";

/**
 * The subset of a product this picker hands back to its parent. Kept narrow on
 * purpose: the caller only needs the identity and the unit to prefill.
 */
export interface PickedProduct {
  id: string;
  name: string;
  brand: string | null;
  defaultUnit: string;
}

interface ProductPickerProps {
  /** Currently selected product id, or "" for none. */
  value: string;
  /** Called with the whole product so the caller can prefill the unit. */
  onChange: (product: PickedProduct | null) => void;
  /** Already-translated error message. Rendered inline and linked via aria-describedby. */
  error?: string;
  /**
   * The sentence under the field, already translated, supplied by the page.
   *
   * A prop rather than a key, because it is the one string here that depends on
   * what the page is *for* — ISSUES.md UI-3 item 8. This component read
   * `inventory.add.*` outright, so `/inventory/consume` told people to "elige
   * el producto al que quieres **añadir** stock", which is the wrong verb on a
   * page about using things up. Confirmed in a browser before it was fixed.
   */
  hint: string;
}

function toPicked(product: PickedProduct): PickedProduct {
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    defaultUnit: product.defaultUnit,
  };
}

/**
 * Product selection for the stock screens.
 *
 * A free-text filter plus a native <select>. The select is used rather than a
 * custom combobox because it is keyboard- and screen-reader-correct for free,
 * and the filter above it keeps the option list short when a household has
 * hundreds of products.
 *
 * Beside the filter, "Escanear" opens the camera (`ScanProductDialog`): a known
 * code comes back chosen. An unknown one can be said to belong to a product
 * already in the catalogue, and then the code waits here until that product
 * is chosen and the person saves it onto it — explicitly, because it replaces
 * whatever code the product had.
 */
export function ProductPicker({
  value,
  onChange,
  error,
  hint,
}: ProductPickerProps) {
  // The labels are the same wherever this is used, so they live in a namespace
  // of their own rather than in whichever page happened to be written first.
  const t = useTranslations("inventory.picker");
  const tScan = useTranslations("products.scanPick");
  const [search, setSearch] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  /** A product the camera found, which the filtered list may not hold. */
  const [scannedProduct, setScannedProduct] = useState<PickedProduct | null>(
    null,
  );
  /** An unknown code waiting for the product it belongs to. */
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [assignNote, setAssignNote] = useState("");
  // Keeps typing responsive: the query re-runs against the settled value.
  const deferredSearch = useDeferredValue(search);

  const searchId = useId();
  const selectId = useId();
  const statusId = useId();
  const errorId = useId();

  const trimmedSearch = deferredSearch.trim();

  const { data, isPending } = api.product.list.useQuery(
    {
      limit: 50,
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
    },
    {
      // Hold the previous options on screen while the next page loads, so the
      // list does not blink empty on every keystroke.
      placeholderData: (previous) => previous,
    },
  );

  const listed = data?.products ?? [];
  const products: Array<PickedProduct & { barcode?: string | null }> =
    scannedProduct && !listed.some((p) => p.id === scannedProduct.id)
      ? [scannedProduct, ...listed]
      : listed;
  const chosen = products.find((product) => product.id === value);

  /**
   * A code typed or scanned into the search chooses its product.
   *
   * A USB or Bluetooth scanner is a keyboard: it types the code into the
   * field with focus, and the server's search matches a barcode exactly. The
   * one product carrying that code is then the answer, not one option among
   * the list, so it is chosen as if picked — keyed on its id, so it happens
   * once per code rather than on every refetch.
   */
  const exactMatch = products.find(
    (product) => trimmedSearch !== "" && product.barcode === trimmedSearch,
  );
  const chooseMatch = useEffectEvent((id: string) => {
    const match = products.find((product) => product.id === id);
    if (match && match.id !== value) onChange(toPicked(match));
  });
  const exactMatchId = exactMatch?.id;
  useEffect(() => {
    if (exactMatchId) chooseMatch(exactMatchId);
  }, [exactMatchId]);

  const statusMessage = isPending
    ? t("loadingProducts")
    : products.length === 0
      ? t("noProducts")
      : hint;

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor={searchId}
          className="mb-1 block text-sm font-medium text-foreground"
        >
          {t("productSearchLabel")}
        </label>
        <div className="flex gap-2">
          <Input
            id={searchId}
            name="product"
            type="search"
            autoComplete="off"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("productSearchPlaceholder")}
          />
          <Button
            className="shrink-0 gap-2"
            onClick={() => setScanOpen(true)}
            type="button"
            variant="outline"
          >
            <ScanLine aria-hidden="true" className="size-5" />
            {tScan("open")}
          </Button>
        </div>
      </div>

      <ScanProductDialog
        onAssign={(code) => {
          setAssignNote("");
          setPendingCode(code);
        }}
        onClose={() => setScanOpen(false)}
        onFound={(product) => {
          setScannedProduct(product);
          setPendingCode(null);
          onChange(product);
        }}
        open={scanOpen}
      />

      <div>
        <label
          htmlFor={selectId}
          className="mb-1 block text-sm font-medium text-foreground"
        >
          {t("productLabel")}
        </label>
        <Select
          id={selectId}
          name="productId"
          required
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${statusId} ${errorId}` : statusId}
          onChange={(event) => {
            const selected = products.find(
              (product) => product.id === event.target.value,
            );
            onChange(selected ? toPicked(selected) : null);
          }}
        >
          <option value="">{t("productPlaceholder")}</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.brand
                ? t("productOption", {
                    name: product.name,
                    brand: product.brand,
                  })
                : product.name}
            </option>
          ))}
        </Select>
        <p
          id={statusId}
          role="status"
          aria-live="polite"
          className="mt-1 text-sm text-muted-foreground"
        >
          {statusMessage}
        </p>
        {error ? (
          <p
            id={errorId}
            className="mt-1 text-sm font-medium text-danger-foreground"
          >
            {error}
          </p>
        ) : null}
      </div>

      {pendingCode ? (
        <AssignCode
          chosen={chosen ?? null}
          code={pendingCode}
          onCancel={() => setPendingCode(null)}
          onSettled={(note, saved) => {
            setAssignNote(note);
            if (saved) setPendingCode(null);
          }}
        />
      ) : null}
      {/* Always mounted, so a saved or refused code is announced. */}
      <p aria-live="polite" className="text-sm" role="status">
        {assignNote}
      </p>
    </div>
  );
}

/**
 * An unknown code waiting for the product it belongs to, and the button that
 * saves it there. Mounted only while a code waits, so a picker with nothing
 * pending holds no mutation.
 */
function AssignCode({
  code,
  chosen,
  onCancel,
  onSettled,
}: {
  code: string;
  chosen: (PickedProduct & { barcode?: string | null }) | null;
  onCancel: () => void;
  onSettled: (note: string, saved: boolean) => void;
}) {
  // Named apart from the picker's `t`: one name per namespace in a file.
  const tScan = useTranslations("products.scanPick");
  const utils = api.useUtils();
  const save = api.product.update.useMutation({
    onSuccess: async () => {
      onSettled(tScan("assignSaved", { code, name: chosen?.name ?? "" }), true);
      await utils.product.invalidate();
    },
    onError: () => onSettled(tScan("assignFailed"), false),
  });

  return (
    <div className="space-y-2 rounded border border-border bg-muted p-3">
      <p>{tScan("assignBanner", { code })}</p>
      {chosen?.barcode && chosen.barcode !== code ? (
        <p className="text-sm text-muted-foreground">
          {tScan("assignReplaces", { name: chosen.name, code: chosen.barcode })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {chosen ? (
          <Button
            disabled={save.isPending}
            onClick={() => save.mutate({ id: chosen.id, barcode: code })}
            type="button"
          >
            {tScan("assignSave", { name: chosen.name })}
          </Button>
        ) : null}
        <Button onClick={onCancel} type="button" variant="outline">
          {tScan("assignCancel")}
        </Button>
      </div>
    </div>
  );
}
