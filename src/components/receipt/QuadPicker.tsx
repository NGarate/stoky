"use client";

import { useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { Point, Quad } from "@/lib/receipt-quad";

const CORNERS = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * A photograph with a four-cornered frame on it that a person moves: the
 * whole ticket when it is sent, or the lines of one article in review.
 *
 * Corners are dragged, or moved from the keyboard with the arrows (Shift for
 * bigger steps). A tap on the photo away from the corners carries the whole
 * frame there, which is how the frame reaches a line far down a long ticket
 * without dragging four corners the whole way. The corners are kept in
 * proportions of the photo (`src/lib/receipt-quad.ts`), so the frame means
 * the same at any size it is drawn.
 */
export function QuadPicker({
  src,
  alt,
  quad,
  onChange,
  hint,
  fit = "screen",
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
  /** The browser could not draw the photo (a HEIC anywhere but Safari). */
  onError?: () => void;
}) {
  const t = useTranslations("receipts.frame");
  const area = useRef<HTMLDivElement>(null);
  const hintId = useId();

  const pointAt = (event: { clientX: number; clientY: number }): Point => {
    const box = area.current!.getBoundingClientRect();
    return [
      clamp((event.clientX - box.left) / box.width),
      clamp((event.clientY - box.top) / box.height),
    ];
  };

  const moved = (corner: number, to: Point) =>
    onChange(quad.map((p, i) => (i === corner ? to : p)) as Quad);

  /** The whole frame centred on `to`, as far as the photo lets it go. */
  const carried = ([x, y]: Point) => {
    const cx = quad.reduce((sum, p) => sum + p[0], 0) / 4;
    const cy = quad.reduce((sum, p) => sum + p[1], 0) / 4;
    const xs = quad.map((p) => p[0]);
    const ys = quad.map((p) => p[1]);
    const dx = Math.min(
      1 - Math.max(...xs),
      Math.max(-Math.min(...xs), x - cx),
    );
    const dy = Math.min(
      1 - Math.max(...ys),
      Math.max(-Math.min(...ys), y - cy),
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
    moved(corner, [clamp(x + dx), clamp(y + dy)]);
  };

  return (
    <div className="space-y-2">
      <p id={hintId} className="text-sm text-muted-foreground">
        {hint}
      </p>
      {/* Half a corner of room on every side: a corner on the photo's edge
          is then whole, and not under the screen's edge or the hint. */}
      <div className="p-6">
        <div ref={area} className="relative mx-auto w-fit select-none">
          <img
            alt={alt}
            className={
              fit === "screen"
                ? "block max-h-[60vh] max-w-full rounded-lg"
                : "block w-full rounded-lg"
            }
            draggable={false}
            // A tap, not a press: a press is also how a long ticket scrolls.
            onClick={(event) => carried(pointAt(event))}
            onError={onError}
            src={src}
          />
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 size-full"
            preserveAspectRatio="none"
            viewBox="0 0 1 1"
          >
            <polygon
              className="fill-primary/15 stroke-primary"
              points={quad.map(([x, y]) => `${x},${y}`).join(" ")}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {quad.map(([x, y], corner) => (
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
