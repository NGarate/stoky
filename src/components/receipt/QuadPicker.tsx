"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { Box, Point, Quad } from "@/lib/receipt-quad";

const CORNERS = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

const WHOLE: Box = { x: 0, y: 0, width: 1, height: 1 };

/**
 * A photograph with a four-cornered frame on it that a person moves: the
 * whole ticket when it is sent, or the lines of one article in review.
 *
 * Corners are dragged, or moved from the keyboard with the arrows (Shift for
 * bigger steps). A tap on the photo away from the corners carries the whole
 * frame there, which is how the frame reaches a line far down a long ticket
 * without dragging four corners the whole way. The corners are kept in
 * proportions of the photo (`src/lib/receipt-quad.ts`), so the frame means
 * the same at any size it is drawn — and whatever part of the photo is
 * shown: `view` shows only that part (the ticket, when lines are framed on
 * it), and the corners stay inside it.
 */
export function QuadPicker({
  src,
  alt,
  quad,
  onChange,
  hint,
  fit = "screen",
  view = WHOLE,
  onError,
}: {
  src: string;
  alt: string;
  quad: Quad;
  onChange: (quad: Quad) => void;
  /** What to do, said beside the photo and given to each corner. */
  hint: string;
  /** The whole photo on the screen, or the photo as wide as the page. */
  fit?: "screen" | "width";
  /** The part of the photo shown; the whole of it by default. */
  view?: Box;
  /** The browser could not draw the photo (a HEIC anywhere but Safari). */
  onError?: () => void;
}) {
  const t = useTranslations("receipts.frame");
  const area = useRef<HTMLDivElement>(null);
  const hintId = useId();
  /** The shown part's width over its height, once the photo has loaded. */
  const [aspect, setAspect] = useState<number | null>(null);

  /** Where on the shown part a point of the photo is drawn, 0 to 1. */
  const shown = ([x, y]: Point): Point => [
    (x - view.x) / view.width,
    (y - view.y) / view.height,
  ];
  /** `[x, y]` kept inside the shown part. */
  const within = ([x, y]: Point): Point => [
    Math.min(view.x + view.width, Math.max(view.x, x)),
    Math.min(view.y + view.height, Math.max(view.y, y)),
  ];

  const pointAt = (event: { clientX: number; clientY: number }): Point => {
    const box = area.current!.getBoundingClientRect();
    return [
      view.x + clamp((event.clientX - box.left) / box.width) * view.width,
      view.y + clamp((event.clientY - box.top) / box.height) * view.height,
    ];
  };

  const moved = (corner: number, to: Point) =>
    onChange(quad.map((p, i) => (i === corner ? to : p)) as Quad);

  /** The whole frame centred on `to`, as far as the shown part lets it go. */
  const carried = ([x, y]: Point) => {
    const cx = quad.reduce((sum, p) => sum + p[0], 0) / 4;
    const cy = quad.reduce((sum, p) => sum + p[1], 0) / 4;
    const xs = quad.map((p) => p[0]);
    const ys = quad.map((p) => p[1]);
    const dx = Math.min(
      view.x + view.width - Math.max(...xs),
      Math.max(view.x - Math.min(...xs), x - cx),
    );
    const dy = Math.min(
      view.y + view.height - Math.max(...ys),
      Math.max(view.y - Math.min(...ys), y - cy),
    );
    onChange(quad.map(([px, py]) => [px + dx, py + dy]) as Quad);
  };

  const onKey = (corner: number, event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const [dx, dy] =
      {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }[event.key] ?? [];
    if (dx === undefined || dy === undefined) return;
    event.preventDefault();
    const [x, y] = quad[corner]!;
    moved(corner, within([x + dx, y + dy]));
  };

  return (
    <div className="space-y-2">
      <p id={hintId} className="text-sm text-muted-foreground">
        {hint}
      </p>
      {/* Half a corner of room on every side: a corner on the photo's edge
          is then whole, and not under the screen's edge or the hint. */}
      <div className="p-6">
        <div
          ref={area}
          className={
            fit === "screen"
              ? "relative mx-auto select-none"
              : "relative w-full select-none"
          }
          style={{
            aspectRatio: aspect ?? undefined,
            // The whole of it on the screen: no taller than 60% of it.
            ...(fit === "screen" &&
              aspect && { width: `min(100%, calc(60vh * ${aspect}))` }),
          }}
        >
          <div className="absolute inset-0 overflow-hidden rounded-lg">
            <img
              alt={alt}
              className="absolute max-w-none"
              draggable={false}
              // A tap, not a press: a press is also how a long ticket scrolls.
              onClick={(event) => carried(pointAt(event))}
              onError={onError}
              onLoad={(event) =>
                setAspect(
                  (event.currentTarget.naturalWidth * view.width) /
                    (event.currentTarget.naturalHeight * view.height),
                )
              }
              src={src}
              style={{
                width: `${100 / view.width}%`,
                height: `${100 / view.height}%`,
                left: `${(-view.x / view.width) * 100}%`,
                top: `${(-view.y / view.height) * 100}%`,
              }}
            />
          </div>
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 size-full"
            preserveAspectRatio="none"
            viewBox="0 0 1 1"
          >
            <polygon
              className="fill-primary/15 stroke-primary"
              points={quad.map((p) => shown(p).join(",")).join(" ")}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {quad.map(shown).map(([x, y], corner) => (
            <Button
              key={CORNERS[corner]}
              aria-describedby={hintId}
              aria-label={t(CORNERS[corner])}
              // `touch-none`: dragging a corner must not scroll the page.
              className="absolute -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-primary bg-background/60 p-0"
              onKeyDown={(event) => onKey(corner, event)}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  moved(corner, pointAt(event));
                }
              }}
              size="icon"
              style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
              type="button"
              variant="ghost"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
