import { useMemo } from "react";
import { encode } from "uqr";
import type { JSX } from "react";

/**
 * The QR code an authenticator app scans to take on a new account (D148).
 *
 * Drawn here, in the browser, from the `otpauth:` address the server handed
 * back once: never an image fetched from anywhere, because the address holds
 * the authenticator's secret, and a QR service — or a server route that drew
 * it — would be one more place that sees it. `uqr` (MIT, no dependencies)
 * only encodes; the drawing is one path, every dark module a unit square, so
 * it stays sharp at any size and the browser does the scaling.
 *
 * - **Four modules of quiet zone**, as the QR specification asks: without a
 *   light margin a camera cannot find the code's edges on a dark page.
 * - **Dark on light in every theme**, from `--qr-dark` and `--qr-light`
 *   (`globals.css`, audited by `check-contrast.ts`): an inverted code is one
 *   many apps do not read.
 * - **Error correction M**, which recovers 15% of the code: a phone screen's
 *   glare costs some, and a denser code would be harder to aim at.
 *
 * `role="img"` with the caller's name, because a screen reader has nothing to
 * read in a grid of squares; the caller puts the same secret beside it as a
 * key to type and a link to open, which is what somebody who cannot scan
 * uses instead.
 */
export function TotpQr({ value, label }: { value: string; label: string }): JSX.Element {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 4 });
    let d = "";
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { size: qr.size, path: d };
  }, [value]);

  return (
    <svg
      aria-label={label}
      className="block h-auto w-full max-w-[16rem]"
      role="img"
      shapeRendering="crispEdges"
      viewBox={`0 0 ${size} ${size}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect className="fill-qr-light" height={size} width={size} />
      <path className="fill-qr-dark" d={path} />
    </svg>
  );
}
