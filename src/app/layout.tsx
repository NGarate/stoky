import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { RouteTitle } from "@/components/ui/route-title";
import { TRPCProvider } from "@/lib/trpc/client";
import { ServiceWorkerProvider } from "@/components/providers/ServiceWorkerProvider";
import { THEME_NO_FLASH_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * No `title` here, deliberately: `<RouteTitle>` below renders the one
 * `<title>` the document has, per route and in the reader's language
 * (`src/lib/route-titles.ts` has the case). A metadata title would be a second
 * `<title>` element, and which of two wins is a question of mount order.
 *
 * The description is static and Spanish, and not a catalogue key. Its only
 * readers are link previews and crawlers, which carry neither a session nor
 * the locale cookie, so the per-request translation it used to be resolved to
 * Spanish for every one of them and its English twin was never served. What
 * that lookup did cost was every route: request-bound metadata is reported by
 * Cache Components as "uncached data in `generateMetadata()`".
 */
export const metadata: Metadata = {
  description: "Gestión de inventario del hogar con privacidad",
  applicationName: "Stoky",
  // `src/app/manifest.ts` is linked by Next on its own. iOS reads none of the
  // manifest's icons, so the home-screen icon and the standalone launch are
  // declared here as well.
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "Stoky", statusBarStyle: "default" },
};

/**
 * The browser chrome's colour, per system theme: `--background` from
 * `src/app/globals.css` in each. A theme chosen in-app rather than by the
 * system is not followed — `theme-color` cannot read `data-theme` — and the
 * cost is a toolbar that differs from the page, not a contrast failure.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1411" },
  ],
};

/**
 * This layout is allowed to block, and that is the answer rather than a to-do.
 *
 * Cache Components asks every route to stream, cache, or explicitly block. This
 * one blocks because it reads two runtime values that drive things with no
 * child to wrap in `<Suspense>`: the locale on `<html lang>`, and the
 * per-request CSP nonce on the bootstrap `<script>` in `<head>`.
 *
 * The locale could be moved to an inline pre-paint script, which is the pattern
 * the migration guide recommends. **The nonce could not, and the conflict is
 * structural: a nonce that survives prerendering is not a nonce.** The value of
 * `strict-dynamic` with a nonce is that the number is unguessable and changes
 * per request; a prerendered shell has one baked into it.
 *
 * So the trade was put to the owner rather than settled here, and the decision
 * was to keep the nonce. `SECURITY.md` documents that posture, and it is not
 * worth trading for a navigation feel. The cost is that the root shell is request-bound; routes
 * below still prerender, and nine of them do.
 *
 * `docs/superpowers/plans/2026-08-25-cache-components-and-instant-navigation.md`
 * carries the measurements.
 */
export const instant = false;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  // The per-request CSP nonce minted in src/proxy.ts. Without it the
  // inline script below is blocked and the chosen theme flashes on every load.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    // suppressHydrationWarning because the script below writes `data-theme` on
    // this element before React hydrates. It is scoped to <html>'s own
    // attributes and does not extend to the tree, so nothing else is silenced.
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Inline by necessity: it must run before first paint, which rules
            out anything fetched. Constant string, no request data, and
            nonce-guarded by the CSP. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: THEME_NO_FLASH_SCRIPT }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <TRPCProvider>
          <NextIntlClientProvider messages={messages}>
            <RouteTitle />
            <ServiceWorkerProvider />
            {children}
          </NextIntlClientProvider>
        </TRPCProvider>
      </body>
    </html>
  );
}
