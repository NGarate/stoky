import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { TRPCProvider } from "@/components/providers/TRPCProvider";
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

export const metadata: Metadata = {
  title: "Stoky - Inventory Management",
  description: "Privacy-first household inventory management",
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
 * was to keep the nonce. `SECURITY.md` documents that posture and
 * `e2e/auth.prod.spec.ts` guards it, and neither is worth trading for a
 * navigation feel. The cost is that the root shell is request-bound; routes
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
            <ServiceWorkerProvider />
            {children}
          </NextIntlClientProvider>
        </TRPCProvider>
      </body>
    </html>
  );
}
