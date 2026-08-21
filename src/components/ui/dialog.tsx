"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
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
 * Both, however, say `aria-modal="true"` while leaving the rest of the page
 * reachable — nothing outside them is `inert` or `aria-hidden`. `aria-modal`
 * is a promise that everything else is unreachable, and a JS Tab trap only
 * keeps that promise for the Tab key. Neither portals either, so both depend
 * on `z-50` continuing to mean something, which stops being true the moment a
 * dialog opens from inside a transformed or clipped ancestor.
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
            "-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg rounded-lg border bg-card p-5 shadow-lg md:p-6",
            tone === "danger" ? "border-danger-foreground" : "border-border",
            className,
          )}
          data-testid="dialog"
          onCloseAutoFocus={(event) => {
            if (!returnFocus?.current) return;
            // The opener is an ordinary button rather than a Radix trigger, so
            // Radix has nothing to restore to and would drop focus on <body>.
            event.preventDefault();
            returnFocus.current.focus();
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

          <RadixDialog.Close asChild>
            <Button
              aria-label={t("close")}
              className="absolute top-3 right-3"
              size="icon"
              type="button"
              variant="ghost"
            >
              <span aria-hidden="true">✕</span>
            </Button>
          </RadixDialog.Close>
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
      title={title}
      tone="danger"
    />
  );
}
