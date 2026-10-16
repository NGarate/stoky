"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { JSX, ReactNode, RefObject } from "react";

/**
 * A modal panel, and the end of `window.confirm`.
 *
 * Two hand-rolled panels already exist — `NavSheet` and `ReconcileDialog` —
 * and between them they show why a third should not be written by hand.
 * NavSheet gets almost everything right: it renders nothing when closed, moves
 * focus in, returns it to the opener, closes on Escape and on the scrim, and
 * traps Tab through `tabbableWithin`. `ReconcileDialog` gets almost none of
 * that: no Escape, no trap, no focus return, and `role="dialog"` on the scrim
 * rather than on the card.
 *
 * Neither portals, so both depend on `z-50` continuing to mean something,
 * which stops being true the moment a dialog opens from inside a transformed
 * or clipped ancestor. That is what a library gets right and a hand-rolled
 * panel keeps getting wrong, and it is why this one is not hand-rolled.
 *
 * **What `aria-modal="true"` here does and does not promise.** It buys the
 * focus trap, the scroll lock and the blocking of outside pointer events —
 * all measured. It does not currently buy `aria-hidden` on the page behind:
 * Radix calls `hideOthers` from the `aria-hidden` package, and I measured it
 * marking ten nodes in this shell while leaving the one that contains
 * `<main>` alone. Why is not yet understood and is not claimed here. A
 * screen reader in browse mode can therefore still reach the page underneath
 * — the same gap `NavSheet` and `ReconcileDialog` have, neither better nor
 * worse. Worth closing; not closed by this commit, and not asserted by its
 * tests.
 *
 * Those two are exactly what a library does and a hand-rolled panel keeps
 * getting wrong, so this is Radix. Note what NavSheet's own docblock rejects
 * and does not: it rejects the *platform* `<dialog>` element, because
 * `showModal()` is not implemented in the DOM the component tests run
 * against. A userland implementation has no such problem — verified by
 * probing `@radix-ui/react-dialog` under happy-dom before adopting it.
 *
 * NavSheet and ReconcileDialog are deliberately left alone. Migrating them is
 * a second change that can be reverted on its own, and `CompactNav.test.tsx`
 * staying byte-identical is what proves this primitive regressed nothing.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  tone = "neutral",
  returnFocus,
  fallbackFocus,
  className,
}: {
  open: boolean;
  onClose: () => void;
  /** Becomes the dialog's accessible name, as an `<h2>`. */
  title: string;
  /** Becomes `aria-describedby`. Say what is at stake, not "are you sure". */
  description?: string;
  children?: ReactNode;
  /** The actions. Buttons, in the order they should be read. */
  footer: ReactNode;
  tone?: "neutral" | "danger";
  /** Where focus goes on close, when the opener is not a Radix trigger. */
  returnFocus?: RefObject<HTMLElement | null>;
  /**
   * Where focus goes on close when `returnFocus`'s element has left the page:
   * the row it sat in, removed by the very action the dialog confirmed. A
   * detached element takes no focus, so without this focus fell to <body>
   * (WCAG 2.4.3). Something that stays — the list, the section — focusable
   * with `tabIndex={-1}`.
   */
  fallbackFocus?: RefObject<HTMLElement | null>;
  className?: string;
}): JSX.Element {
  const t = useTranslations("common");
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <RadixDialog.Root
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open={open}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className="fixed inset-0 z-50 bg-foreground/60"
          data-testid="dialog-scrim"
        />
        <RadixDialog.Content
          // Radix emits `role="dialog"` and nothing else — it does not set
          // `aria-modal`, so the promise its portal and scroll lock actually
          // keep has to be written out here.
          aria-modal="true"
          className={cn(
            "-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg rounded-lg border bg-card p-5 pt-16 shadow-lg md:p-6 md:pt-16",
            tone === "danger" ? "border-danger-foreground" : "border-border",
            className,
          )}
          data-testid="dialog"
          onCloseAutoFocus={(event) => {
            // The opener is an ordinary button rather than a Radix trigger, so
            // Radix has nothing to restore to and would drop focus on <body>.
            // An opener no longer in the page cannot take focus either, so
            // the fallback has it then.
            const target = [returnFocus?.current, fallbackFocus?.current].find(
              (element) => element?.isConnected,
            );
            if (!target) return;
            event.preventDefault();
            target.focus();
          }}
          onOpenAutoFocus={(event) => {
            // Focus the panel, never the first control in it. A destructive
            // confirmation whose destructive button is focused on open is one
            // Enter keypress from doing the thing it was asked to guard.
            //
            // This is also load-bearing for the test tier, which is worth
            // knowing before anyone "simplifies" it away: letting Radix run
            // its own open-autofocus does not merely change which element is
            // focused, it hangs under happy-dom — the suite times out at 124
            // rather than going red. Measured.
            event.preventDefault();
            panelRef.current?.focus();
          }}
          ref={panelRef}
          tabIndex={-1}
        >
          {/* First in the DOM because it is first on the screen. Rendered
              last, it was read after the footer's actions while being drawn
              a hundred pixels above them — which `e2e/screen-reader.spec.ts`
              caught as a reading-order finding, and which is the whole class
              of defect that audit exists for. */}
          <RadixDialog.Close asChild>
            <Button
              aria-label={t("close")}
              className="absolute top-3 right-3"
              size="icon"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" className="size-5" />
            </Button>
          </RadixDialog.Close>

          <RadixDialog.Title asChild>
            {/* An h2, never an h1: e2e/a11y-structure.spec.ts wants exactly
                one h1 per page and the page underneath already has it. */}
            <h2 className="font-bold text-heading text-xl md:text-2xl">
              {title}
            </h2>
          </RadixDialog.Title>

          {description ? (
            <RadixDialog.Description className="mt-2 text-muted-foreground">
              {description}
            </RadixDialog.Description>
          ) : null}

          {children ? <div className="mt-4">{children}</div> : null}

          <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>

        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/**
 * The one shape a snackbar cannot serve: destructive, irreversible, and with
 * no inverse to offer afterwards.
 *
 * REDESIGN_PLAN section 7 says "undo instead of confirm", and that rule
 * assumes an undo exists. Deleting a shopping list cascades its items and
 * there is no procedure that puts them back, so the only honest moment to ask
 * is before.
 */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  pending = false,
  returnFocus,
  fallbackFocus,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  /** Names what it destroys, so it still says so read out of context. */
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  returnFocus?: RefObject<HTMLElement | null>;
  fallbackFocus?: RefObject<HTMLElement | null>;
}): JSX.Element {
  const t = useTranslations("common");

  return (
    <Dialog
      description={description}
      footer={
        <>
          <Button onClick={onCancel} type="button" variant="outline">
            {cancelLabel ?? t("cancel")}
          </Button>
          <Button
            disabled={pending}
            onClick={onConfirm}
            type="button"
            variant="destructive"
          >
            {confirmLabel}
          </Button>
        </>
      }
      onClose={onCancel}
      open={open}
      returnFocus={returnFocus}
      fallbackFocus={fallbackFocus}
      title={title}
      tone="danger"
    />
  );
}
