"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { BarcodeScanner } from "@/components/barcode/Scanner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/trpc/client";
import { invalidateAfterProductCreated } from "@/lib/trpc/stale";
import type { FormEvent, JSX } from "react";

/** What a scan hands back: the product, as the pickers carry one. */
export interface ScannedProduct {
  id: string;
  name: string;
  brand: string | null;
  defaultUnit: string;
}

type Phase =
  | { kind: "scanning" }
  | { kind: "looking"; code: string }
  | { kind: "unknown"; code: string }
  | { kind: "failed"; code: string };

function scanned(product: ScannedProduct): ScannedProduct {
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    defaultUnit: product.defaultUnit,
  };
}

/**
 * Scanning as a way to *choose* a product, from wherever one is chosen.
 *
 * It used to be a destination of its own (`/products/scan`, a slot in the
 * phone's bar), which made it a detour: scan there, then come back and pick
 * the same product from a list. Grocy puts the camera beside the product
 * field instead, and so does this — the picker opens it, and a known code
 * comes back as the product, chosen.
 *
 * A code the household does not know is a question, asked here rather than
 * by sending the person to another screen (Grocy's three answers, less the
 * one that needs a product to have several codes):
 *
 * - look it up in Open Food Facts, which creates it when found
 *   (`product.scanBarcode`, the scan page's own path);
 * - create it here, with the code already on it;
 * - say it is a product already in the catalogue — `onAssign`, for a caller
 *   that can then save the code onto the one chosen.
 *
 * The lookup is `getByBarcode`, a read, so a kitchen account can scan to
 * choose; creating and looking up outside are writes, refused to it by the
 * server and said so here.
 */
export function ScanProductDialog({
  open,
  onClose,
  onFound,
  onAssign,
}: {
  open: boolean;
  onClose: () => void;
  onFound: (product: ScannedProduct) => void;
  /** Offered for an unknown code when present. */
  onAssign?: (code: string) => void;
}): JSX.Element | null {
  if (!open) return null;
  return (
    <ScanProductPanel onAssign={onAssign} onClose={onClose} onFound={onFound} />
  );
}

/** Mounted only while open, so its camera and its state go with it. */
function ScanProductPanel({
  onClose,
  onFound,
  onAssign,
}: {
  onClose: () => void;
  onFound: (product: ScannedProduct) => void;
  onAssign?: (code: string) => void;
}): JSX.Element {
  const t = useTranslations("products.scanPick");
  const utils = api.useUtils();
  const [phase, setPhase] = useState<Phase>({ kind: "scanning" });
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [lookupMissed, setLookupMissed] = useState(false);
  const [typed, setTyped] = useState("");
  const nameId = useId();
  const typedId = useId();

  function found(product: ScannedProduct): void {
    onFound(scanned(product));
    onClose();
  }

  async function look(code: string): Promise<void> {
    setPhase({ kind: "looking", code });
    try {
      const product = await utils.product.getByBarcode.fetch({ barcode: code });
      if (product) found(product);
      else setPhase({ kind: "unknown", code });
    } catch {
      setPhase({ kind: "failed", code });
    }
  }

  const lookUp = api.product.scanBarcode.useMutation({
    onSuccess: async (result) => {
      if (!result.product) {
        setLookupMissed(true);
        return;
      }
      await invalidateAfterProductCreated(utils);
      found(result.product);
    },
    onError: () => setProblem(t("lookupFailed")),
  });

  const create = api.product.create.useMutation({
    onSuccess: async (product) => {
      await invalidateAfterProductCreated(utils);
      found(product);
    },
    onError: () => setProblem(t("createFailed")),
  });

  const code = phase.kind === "scanning" ? null : phase.code;
  const busy = lookUp.isPending || create.isPending;

  function handleCreate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    event.stopPropagation();
    if (!code || !name.trim()) return;
    setProblem(null);
    create.mutate({ name: name.trim(), barcode: code });
  }

  return (
    <Dialog onClose={onClose} open title={t("title")}>
      {phase.kind === "scanning" ? (
        <>
          <BarcodeScanner onScan={(value) => void look(value.trim())} />
          {/* A code the camera cannot read — torn, curled, or in the dark —
              can still be typed. */}
          <form
            className="mt-4 flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              // The dialog is portalled out of the DOM but not out of React,
              // and React carries a submit up its own tree: without this, a
              // picker inside a page's form submits the page's form too.
              event.stopPropagation();
              if (typed.trim()) void look(typed.trim());
            }}
          >
            <div className="flex-1">
              <label className="block text-sm font-medium" htmlFor={typedId}>
                {t("typedLabel")}
              </label>
              <Input
                autoComplete="off"
                className="mt-1"
                id={typedId}
                inputMode="numeric"
                onChange={(event) => setTyped(event.target.value)}
                value={typed}
              />
            </div>
            <Button type="submit" variant="outline">
              {t("typedSubmit")}
            </Button>
          </form>
        </>
      ) : null}

      {/* Always mounted, so what it says next is announced. */}
      <p aria-live="polite" role="status">
        {phase.kind === "looking" ? t("looking", { code: phase.code }) : ""}
      </p>

      {phase.kind === "failed" ? (
        <div className="space-y-3">
          <p className="text-danger-foreground">{t("failed")}</p>
          <Button onClick={() => void look(phase.code)} type="button">
            {t("retry")}
          </Button>
        </div>
      ) : null}

      {phase.kind === "unknown" ? (
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-heading">
              {t("unknownTitle", { code: phase.code })}
            </h3>
            <p className="mt-1 text-muted-foreground">{t("unknownBody")}</p>
          </div>

          {lookupMissed ? (
            <p>{t("lookupNotFound")}</p>
          ) : (
            <Button
              disabled={busy}
              onClick={() => {
                setProblem(null);
                lookUp.mutate({ barcode: phase.code });
              }}
              type="button"
              variant="outline"
            >
              {lookUp.isPending ? t("lookupWorking") : t("lookup")}
            </Button>
          )}

          <form className="space-y-2" onSubmit={handleCreate}>
            <label className="block text-sm font-medium" htmlFor={nameId}>
              {t("nameLabel")}
            </label>
            <Input
              id={nameId}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
            <Button disabled={busy || !name.trim()} type="submit">
              {t("create")}
            </Button>
          </form>

          {onAssign ? (
            <Button
              onClick={() => {
                onAssign(phase.code);
                onClose();
              }}
              type="button"
              variant="outline"
            >
              {t("assign")}
            </Button>
          ) : null}

          {problem ? (
            <p className="font-medium text-danger-foreground" role="alert">
              {problem}
            </p>
          ) : null}

          <Button
            onClick={() => {
              setProblem(null);
              setLookupMissed(false);
              setName("");
              setPhase({ kind: "scanning" });
            }}
            type="button"
            variant="ghost"
          >
            {t("scanAgain")}
          </Button>
        </div>
      ) : null}
    </Dialog>
  );
}
