"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense } from "react";

import { originOf, popTo } from "@/lib/back";

import type { JSX, MouseEvent, ReactNode } from "react";

export interface Back {
  href: string;
  /** Names the destination: "Volver a tus listas", not "Volver". */
  label: string;
  /** For the link: pops history instead when that is where it leads. */
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/** `path` with the words that name it, from the one table (`src/lib/back.ts`). */
function useBackTo(path: string): Back {
  const t = useTranslations("navigation.backTo");
  const back = originOf(path);
  if (!back) throw new Error(`No way back is named for ${path}`);
  return {
    href: back.href,
    label: t(back.labelKey),
    onClick: (event) => {
      // A modified click asks for a new tab or window, which is the link's.
      const plain =
        event.button === 0 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey;
      if (plain && popTo(back.href)) event.preventDefault();
    },
  };
}

/** The screen that linked here with `?from=`, or `null`. */
export function useOrigin(): string | null {
  return originOf(useSearchParams().get("from"))?.href ?? null;
}

/**
 * The way back: to the screen that linked here with `?from=`, or to
 * `fallback` — the page's own parent — when nothing did.
 *
 * Every way back goes through this, so there is one rule and one set of
 * words for it. Reading the query opts the caller out of prerendering: a
 * statically rendered page uses it through `WithBack`, which brings its own
 * Suspense boundary.
 */
export function useBack(fallback: string): Back {
  return useBackTo(useOrigin() ?? fallback);
}

type Render = (back: Back) => ReactNode;

function Fallback({ path, children }: { path: string; children: Render }) {
  return children(useBackTo(path));
}

function Resolved({ path, children }: { path: string; children: Render }) {
  return children(useBack(path));
}

/**
 * `useBack` under its own Suspense boundary, for a link on a prerendered
 * page. Until the query is read the fallback renders, which is also what a
 * page reached directly shows.
 */
export function WithBack({
  fallback,
  children,
}: {
  fallback: string;
  children: Render;
}): JSX.Element {
  return (
    <Suspense fallback={<Fallback path={fallback}>{children}</Fallback>}>
      <Resolved path={fallback}>{children}</Resolved>
    </Suspense>
  );
}
