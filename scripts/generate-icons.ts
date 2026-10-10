/**
 * Rasterises the application icon into the PNGs the web app manifest and iOS
 * need.
 *
 * Run: bun scripts/generate-icons.ts
 *
 * The SVGs in `public/icons/` are the source; the PNGs are committed output,
 * because a browser deciding whether the app is installable fetches them and
 * there is no build step that could make them. Re-run this after editing an
 * SVG — `src/__tests__/unit/pwa-manifest.test.ts` checks every PNG has the
 * dimensions the manifest declares, not that it is up to date.
 *
 * `sharp` rather than `Bun.Image`: this is a developer tool that never ships,
 * `sharp` is already a devDependency, and it rasterises SVG, which is the one
 * thing needed here. `no-sharp-in-src.test.ts` guards `src/`, not `scripts/`.
 */
import { join } from "node:path";
import sharp from "sharp";

const ICONS = join(import.meta.dir, "..", "public", "icons");

/** Source SVG, output file, edge length in pixels. */
const OUTPUTS: ReadonlyArray<readonly [string, string, number]> = [
  ["icon.svg", "icon-192.png", 192],
  ["icon.svg", "icon-512.png", 512],
  // Full-bleed background: the platform cuts its own shape out of it, so the
  // rounded corners of `icon.svg` would show as a lighter ring.
  ["icon-maskable.svg", "icon-maskable-512.png", 512],
  // iOS ignores the manifest's icons and applies its own corner mask, so it
  // gets the full-bleed one too.
  ["icon-maskable.svg", "apple-touch-icon.png", 180],
];

for (const [source, output, size] of OUTPUTS) {
  await sharp(join(ICONS, source), { density: 300 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(join(ICONS, output));
  console.log(`${output} ${size}x${size}`);
}
