import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import manifest from "@/app/manifest";

/**
 * What makes Stoky installable, and what keeps it installable.
 *
 * For a long time it was not: `public/sw.js` registered and cached, and the
 * application still had no manifest, no icon and no `<link rel="manifest">`,
 * so every browser treated it as a website. Nothing went red, because nothing
 * asked. Chromium's install criteria are the floor checked here — a name, a
 * start URL, a standalone-class display, and PNG icons at 192 and 512 — plus a
 * maskable icon, without which Android draws the square one inside a white
 * circle.
 *
 * The icon files are checked by reading their PNG header, not by existence: a
 * 512 entry pointing at a 192 image is declared correctly and rejected by the
 * browser, and only the dimensions say so.
 */

const ROOT = join(import.meta.dir, "..", "..", "..");
const PUBLIC = join(ROOT, "public");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Width and height from a PNG's IHDR chunk, which is always first. */
function pngSize(path: string): [number, number] {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/** A token's value in the first CSS block whose selector is exactly `selector`. */
function token(selector: string, name: string): string {
  const css = read("src/app/globals.css");
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf("}", start));
  const match = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  expect(match).not.toBeNull();
  return match![1].trim();
}

const m = manifest();

describe("the web app manifest", () => {
  it("meets the install criteria", () => {
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.start_url).toBe("/");
    expect(["standalone", "fullscreen", "minimal-ui"]).toContain(m.display ?? "browser");
  });

  it("declares a 192 and a 512 icon for any purpose, and a maskable one", () => {
    const icons = m.icons ?? [];
    const sizesFor = (purpose: string) =>
      icons
        .filter((icon) => (icon.purpose ?? "any").split(" ").includes(purpose))
        .map((icon) => icon.sizes);
    expect(sizesFor("any")).toContain("192x192");
    expect(sizesFor("any")).toContain("512x512");
    expect(sizesFor("maskable")).toContain("512x512");
  });

  it("points every icon at a PNG of the size it declares", () => {
    for (const icon of m.icons ?? []) {
      const [width, height] = pngSize(join(PUBLIC, icon.src));
      expect(`${width}x${height}`).toBe(icon.sizes!);
    }
  });

  it("takes its colours from the light theme's tokens", () => {
    expect(m.background_color).toBe(token(":root", "background"));
    expect(m.theme_color).toBe(token(":root", "primary"));
  });

  it("keeps every shortcut inside the app's scope", () => {
    for (const shortcut of m.shortcuts ?? []) {
      expect(shortcut.url.startsWith(m.scope ?? "/")).toBe(true);
    }
  });
});

describe("the icons the root layout and the manifest reference", () => {
  const sources = read("src/app/layout.tsx") + read("src/app/manifest.ts");
  const paths = [...new Set(sources.match(/\/icons\/[\w.-]+/g) ?? [])];

  it("all exist under public/", () => {
    expect(paths.length).toBeGreaterThanOrEqual(5);
    for (const path of paths) expect(existsSync(join(PUBLIC, path))).toBe(true);
  });

  it("give iOS a 180px touch icon", () => {
    expect(pngSize(join(PUBLIC, "icons/apple-touch-icon.png"))).toEqual([180, 180]);
  });

  it("are reachable without the proxy, which would stamp a nonce and a cookie on them", () => {
    expect(read("src/proxy.ts")).toContain("icons/|");
  });

  it("paint the glyph and its ground in the tokens they were drawn from", () => {
    for (const svg of ["icons/icon.svg", "icons/icon-maskable.svg"]) {
      const source = readFileSync(join(PUBLIC, svg), "utf8");
      expect(source).toContain(`fill="${token(":root", "primary")}"`);
      expect(source).toContain(`stroke="${token(":root", "background")}"`);
    }
  });
});

describe("the browser chrome colour", () => {
  it("is each system theme's background", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain(
      `{ media: "(prefers-color-scheme: light)", color: "${token(":root", "background")}" }`,
    );
    expect(layout).toContain(
      `{ media: "(prefers-color-scheme: dark)", color: "${token(':root[data-theme="dark"]', "background")}" }`,
    );
  });
});
