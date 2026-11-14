import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { readInstallationNames } from "@/lib/household-names";

/**
 * The web app manifest, served at `/manifest.webmanifest`.
 *
 * Without it the browser has nothing to install: Chrome and Edge show no
 * install entry, Android's "Add to Home screen" makes a bookmark that opens in
 * a tab, and iOS falls back to a screenshot for the icon. The service worker
 * alone never made this an installable application.
 *
 * `DECISIONS.md` PWA still holds where it matters: nothing here *prompts*
 * anyone to install, and push and background sync stay deferred. This only
 * makes the browser's own install action produce an app instead of a
 * bookmark.
 *
 * Per request, because the name is the household's (`Household.appName`, else
 * its name, else `Stoky`: `src/lib/household-names.ts`), and a prerender
 * would bake in whatever `next build` saw; `connection()` keeps the query out
 * of the build. The browser fetches this without credentials, so that name is
 * public (SECURITY.md). An app already installed picks up a new one only when
 * the browser re-reads this: Chrome on its own schedule, iOS not until it is
 * installed again, and iOS reads the name from the root layout's
 * `apple-mobile-web-app-title` rather than from here.
 *
 * The rest is Spanish, for the reason the root layout's description is: the
 * browser fetches this without the locale cookie, so a per-request
 * translation would resolve to Spanish for everyone anyway.
 *
 * Colours are `--background` and `--primary` from `src/app/globals.css`, light
 * theme; `pwa-manifest.test.ts` fails if they drift from the tokens.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  await connection();
  return webManifest((await readInstallationNames()).app);
}

/** The manifest for an app called `name`, kept apart so a test needs no database. */
export function webManifest(name: string): MetadataRoute.Manifest {
  return {
    id: "/",
    name,
    short_name: name,
    description: "Gestión de inventario del hogar con privacidad",
    lang: "es",
    dir: "ltr",
    // The landing page decides which screen this device opens on
    // (`src/lib/landing/`), so the app starts where a tab would.
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f6f4",
    theme_color: "#0e4f42",
    categories: ["food", "lifestyle", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // The two screens that are used away from a desk, reachable from a long
    // press on the installed icon.
    shortcuts: [
      { name: "Compra", url: "/shopping" },
      { name: "Cocina", url: "/kitchen" },
      { name: "Inventario", url: "/inventory" },
    ],
  };
}
