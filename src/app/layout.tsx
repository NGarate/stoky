import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { TRPCProvider } from "@/components/providers/TRPCProvider";
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  // The per-request CSP nonce minted in src/middleware.ts. Without it the
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
            {children}
          </NextIntlClientProvider>
        </TRPCProvider>
      </body>
    </html>
  );
}
