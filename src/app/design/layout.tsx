import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./lab.css";

export const metadata: Metadata = {
  title: "Stoky — propuestas de diseño",
  description:
    "Cinco refactorizaciones de la página de inventario, con tema claro y oscuro y contraste AAA.",
};

/**
 * Applies the stored theme before first paint, so a chosen theme does not
 * flash the other one on load. Kept tiny and dependency-free on purpose.
 */
const NO_FLASH = `
try {
  var m = localStorage.getItem("stoky-design-theme");
  if (m === "light" || m === "dark") {
    document.documentElement.setAttribute("data-theme", m);
  }
} catch (e) {}
`;

export default async function DesignLabLayout({
  children,
}: {
  children: ReactNode;
}) {
  // The CSP nonce minted per request in src/middleware.ts. Without it this
  // inline script is blocked and the stored theme flashes on every load.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant string, no interpolation */}
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      {children}
    </>
  );
}
