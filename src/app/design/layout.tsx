import type { Metadata } from "next";
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

export default function DesignLabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant string, no interpolation */}
      <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      {children}
    </>
  );
}
