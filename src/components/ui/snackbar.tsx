"use client";

import * as Toast from "@radix-ui/react-toast";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useWriteQueue } from "@/lib/offline/queue-context";
import {
  DURATION_MS,
  getServerSnackbarDurationSnapshot,
  getSnackbarDurationSnapshot,
  subscribeSnackbarDuration,
} from "@/lib/snackbar-duration";
import { cn } from "@/lib/utils";

import type { OpLabel } from "@/lib/offline/queue";
import type { JSX, ReactNode } from "react";

/**
 * One snackbar, mounted once, for every transient confirmation in the
 * application.
 *
 * Before this, an action told you it had happened in five different ways:
 * a whole success screen, an inline `role="status"` paragraph that stayed
 * for ever, a native `alert()`, a native `confirm()`, or — six times —
 * nothing at all. This is the single answer, and `docs/PROGRESS.md` D101
 * records which situations it is *not* the answer for.
 *
 * ## Why it is never `role="alert"`
 *
 * `SyncStatus` documents the rule this obeys (its lines 64-69): a live
 * region's role must never alternate, and Next's own route announcer is
 * already a `role="alert"`, so a second one makes `getByRole("alert")`
 * ambiguous in every browser test. Radix's toast announces through
 * `role="status"`; passing `type="background"` makes that region polite
 * rather than assertive. Anything genuinely urgent belongs in `SyncStatus`'s
 * `sync-urgent` region, which is already assertive and already the only one.
 *
 * ## Why it does not steal focus
 *
 * It is rendered after `<main>`, so it never intrudes on the tab order of
 * someone working down the page — but a ten-second undo is not something you
 * can reach by tabbing there. Radix's `F8` hotkey jumps to it, and the
 * viewport names that key in its own label so the shortcut is discoverable
 * rather than folklore.
 *
 * ## Why an undo never expires early, and never lingers
 *
 * `undo-queued` asks the queue how long the change can still be taken back
 * and lives exactly that long. Undo is `queue.cancel` and nothing else —
 * D57's invariant, enforced here by the type rather than by convention: the
 * variant that carries an `opId` has no `undo` function to call. A window
 * with under two seconds left degrades to a plain confirmation instead of
 * drawing a button that will stop working before it can be pressed.
 */

export type SnackbarInput =
  | { kind: "confirm"; message: OpLabel; tone?: "neutral" | "danger" }
  | { kind: "undo-queued"; message: OpLabel; opId: string }
  | {
      kind: "undo-inverse";
      message: OpLabel;
      undo: () => void | Promise<void>;
      undoLabel?: OpLabel;
      durationMs?: number;
    };

export interface SnackbarApi {
  /** Returns the id, so a caller can take its own message back. */
  show(input: SnackbarInput): string;
  dismiss(id: string): void;
}

const SnackbarContext = createContext<SnackbarApi | null>(null);

/** Throws rather than returning null: feedback outside the shell is a bug. */
export function useSnackbar(): SnackbarApi {
  const value = useContext(SnackbarContext);
  if (!value) {
    throw new Error(
      "useSnackbar must be used inside SnackbarProvider — see (dashboard)/layout.tsx",
    );
  }
  return value;
}

/** Below this, the button would stop working before it could be pressed. */
const MIN_UNDO_MS = 2_000;

/**
 * How many undos may stand at once.
 *
 * Three, because the alternative to a cap is a wall: someone ticking a
 * trolley off item by item would end up reading their own shopping list back
 * through a stack of snackbars. When a fourth arrives the oldest goes, which
 * is the one whose window is closest to expiry anyway — its change simply
 * sends, which is what would have happened had nobody pressed the button.
 */
const MAX_UNDO_STACK = 3;

interface Entry extends Omit<SnackbarInput, "kind"> {
  id: string;
  kind: SnackbarInput["kind"];
  message: OpLabel;
  tone?: "neutral" | "danger";
  opId?: string;
  undo?: () => void | Promise<void>;
  undoLabel?: OpLabel;
  durationMs?: number;
}

export function SnackbarProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [queued, setQueued] = useState<Entry[]>([]);
  const nextId = useRef(0);

  const show = useCallback((input: SnackbarInput): string => {
    const id = `snackbar-${nextId.current++}`;
    const entry: Entry = { ...input, id };

    setQueued((current) => {
      const undos = current.filter((queuedEntry) => queuedEntry.kind !== "confirm");
      const confirms = current.filter((queuedEntry) => queuedEntry.kind === "confirm");

      // A confirmation replaces a confirmation — nobody needs the previous
      // one — but never an undo. Taking away the button someone is reaching
      // for is exactly the failure D54 rejected toasts over, so a
      // confirmation arriving over an undo still waits behind it.
      if (entry.kind === "confirm") return [...undos, entry];

      // Undoable changes stand beside each other rather than in a line.
      //
      // They used to queue, and only the head was rendered — so tapping two
      // things in quick succession meant the second one's confirmation
      // appeared when the first had finished, up to ten seconds later, by
      // which time its *own* window had run out and it was shown with no
      // undo at all. Each queued change holds its own independent window;
      // making them wait for each other is what threw the second one away.
      return [...undos, entry].slice(-MAX_UNDO_STACK).concat(confirms);
    });

    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setQueued((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const api = useMemo<SnackbarApi>(() => ({ show, dismiss }), [show, dismiss]);

  // Every live undo, or — when there is none — the first confirmation.
  const undos = queued.filter((entry) => entry.kind !== "confirm");
  const visible = undos.length > 0 ? undos : queued.slice(0, 1);

  return (
    <SnackbarContext.Provider value={api}>
      {/* `label` is the word Radix prepends inside the announced region, and
          its default is the English "Notification" — which a screen reader in
          a Spanish session reads aloud verbatim. Every string in this
          application comes from the catalogue; this one has to as well. */}
      <SnackbarProviderRoot>
        {children}
        {visible.map((entry) => (
          <SnackbarRoot
            entry={entry}
            key={entry.id}
            onClosed={() => dismiss(entry.id)}
          />
        ))}
        <SnackbarViewport />
      </SnackbarProviderRoot>
    </SnackbarContext.Provider>
  );
}

/** `Toast.Provider` with its announced prefix translated. */
function SnackbarProviderRoot({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const t = useTranslations();

  return (
    <Toast.Provider label={t("snackbar.announcePrefix")} swipeDirection="down">
      {children}
    </Toast.Provider>
  );
}

function SnackbarViewport(): JSX.Element {
  const t = useTranslations();

  return (
    <Toast.Viewport
      // Clear of the phone's bottom bar, which is `md:hidden` and covers the
      // bottom of the viewport. A popup drawn over a 48px navigation target
      // is ISSUES UI-6, a defect this project has already shipped once, so
      // the offset is measured against the bar in `e2e/snackbar.spec.ts`
      // rather than trusted here.
      className="fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 m-0 flex list-none flex-col items-center gap-2 px-4 outline-none md:bottom-6"
      // Names the hotkey, so reaching the undo is discoverable rather than
      // folklore. Radix's default is F8 and this must agree with it.
      label={t("snackbar.regionLabel")}
    />
  );
}

function SnackbarRoot({
  entry,
  onClosed,
}: {
  entry: Entry;
  onClosed: () => void;
}): JSX.Element {
  const t = useTranslations();
  const queue = useWriteQueue();
  const snackbar = useSnackbar();
  const preference = useSyncExternalStore(
    subscribeSnackbarDuration,
    getSnackbarDurationSnapshot,
    getServerSnackbarDurationSnapshot,
  );

  // The label is stored as `{key, values}` and rendered here, never composed
  // into a sentence at the call site: a message written in Spanish and read
  // after a language switch would otherwise be half in each (queue.ts:41-47).
  const message = t(entry.message.key, entry.message.values);

  // Captured once, on mount, and never recomputed.
  //
  // It was read on every render, and the comment here claimed that amounted
  // to the same thing. It does not. This component re-renders whenever the
  // shell does, and the window shrinks in real time, so two things went
  // wrong at once. Radix restarts its close timer whenever `duration`
  // changes (`react-toast` index.mjs:353-356), so a snackbar meant to live
  // ten seconds kept being given a fresh, shorter one. And once the
  // remainder fell under `MIN_UNDO_MS`, `undoDuration` stopped matching its
  // first branch and fell through to the *preference* duration — so the
  // snackbar outlived the window it was measuring, and under "hasta
  // descartar" it never closed at all.
  //
  // A lazy `useState` initialiser rather than a `useRef`, so the clock is
  // read once at mount instead of on every render: the component is keyed by
  // entry id, so a new snackbar is a new mount and gets its own reading.
  const [heldMs] = useState(() =>
    entry.kind === "undo-queued" && entry.opId
      ? queue.holdRemainingMs(entry.opId)
      : 0,
  );

  /**
   * Whether the hold has run out while the snackbar was still up.
   *
   * Radix pauses its own close timer while the pointer is over the snackbar,
   * while focus is in it (F8) and while the window is blurred — and the
   * queue's hold does not pause for any of that. So the snackbar could outlive
   * the window it was measuring, still offering "Deshacer" over a change
   * already on its way to the server. The button goes when the hold does.
   */
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (entry.kind !== "undo-queued" || heldMs < MIN_UNDO_MS) return;
    const timer = setTimeout(() => setExpired(true), heldMs);
    return () => clearTimeout(timer);
  }, [entry.kind, heldMs]);

  const undoable =
    entry.kind === "undo-inverse" ||
    (entry.kind === "undo-queued" && heldMs >= MIN_UNDO_MS && !expired);

  const duration = undoDuration(entry, heldMs, preference);

  const runUndo = (): void => {
    if (entry.kind === "undo-queued" && entry.opId) {
      // D57: undo is taking the queued change back, never a compensating
      // write. A stock movement that never happened must leave no trace.
      //
      // `cancel` says false when the change is already sent or being sent.
      // That used to be ignored, and the snackbar closed exactly as it does
      // after an undo that worked — so somebody was told, by omission, that
      // a change the server now holds had been taken back.
      if (!queue.cancel(entry.opId)) {
        snackbar.show({
          kind: "confirm",
          tone: "danger",
          message: { key: "snackbar.undoTooLate" },
        });
      }
      return;
    }
    void entry.undo?.();
  };

  return (
    <Toast.Root
      className={cn(
        "pointer-events-auto flex w-full max-w-xl flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-4 py-3 shadow-lg",
        "bg-snackbar text-snackbar-foreground",
        "data-[state=closed]:opacity-0 data-[state=open]:opacity-100 transition-opacity",
      )}
      data-testid="snackbar"
      duration={duration}
      onOpenChange={(open) => {
        if (!open) onClosed();
      }}
      open={true}
      // Polite, always. See the note on `role="alert"` above.
      type="background"
    >
      {/* A failure looks like a failure.
          `tone` was declared on the input type and read by nobody, so the
          three call sites that pass `tone: "danger"` — a store that could not
          be deleted, an upload that failed, an export that failed — drew the
          identical bar a success draws.

          Two carriers, neither of them colour alone. The icon is
          `aria-hidden`, so what a screen reader gets is the message, and
          every one of those messages already says in words that the thing did
          not work; the tint and the icon are for the glance. */}
      {entry.tone === "danger" ? (
        <AlertTriangle
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-snackbar-danger"
        />
      ) : null}

      <Toast.Title
        className={cn(
          "min-w-0 flex-1",
          entry.tone === "danger" && "text-snackbar-danger",
        )}
      >
        {message}
      </Toast.Title>

      {undoable ? (
        <Toast.Action
          altText={t(entry.undoLabel?.key ?? "snackbar.undo", entry.undoLabel?.values)}
          asChild
        >
          <button
            className="min-h-[48px] shrink-0 rounded-md px-3 font-medium text-snackbar-action underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-snackbar-action"
            onClick={runUndo}
            type="button"
          >
            {t("snackbar.undo")}
          </button>
        </Toast.Action>
      ) : null}

      <Toast.Close
        aria-label={t("snackbar.dismiss")}
        className="min-h-[48px] min-w-[48px] shrink-0 rounded-md text-snackbar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-snackbar-action"
      >
        <span aria-hidden="true">✕</span>
      </Toast.Close>
    </Toast.Root>
  );
}

/**
 * How long this snackbar lives.
 *
 * An undo's life is not a preference: it is the window in which pressing the
 * button still works. Outliving it would leave a button that does nothing;
 * ending early would take away an undo that was still good. Under WCAG 2.2.1
 * that makes the duration essential — extending it would invalidate the
 * activity — which is the criterion's own exception.
 *
 * Everything else takes the device's preference, including "wait to be
 * dismissed".
 */
function undoDuration(
  entry: Entry,
  heldMs: number,
  preference: ReturnType<typeof getSnackbarDurationSnapshot>,
): number | undefined {
  if (entry.kind === "undo-queued" && heldMs >= MIN_UNDO_MS) return heldMs;
  if (entry.kind === "undo-inverse") {
    return entry.durationMs ?? DURATION_MS.long ?? undefined;
  }
  const ms = DURATION_MS[preference];
  // Radix treats Infinity as "never close on its own".
  return ms ?? Number.POSITIVE_INFINITY;
}
