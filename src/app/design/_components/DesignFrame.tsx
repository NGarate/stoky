import Link from "next/link";
import type { ReactNode } from "react";
import { DESIGNS, type Design, themeCss } from "../_lib/tokens";
import { ThemeControl } from "./ThemeControl";

/**
 * Chrome shared by every proposal: token injection, the theme control, a skip
 * link, and a strip for moving between proposals. Deliberately unstyled by the
 * designs themselves — it is scaffolding for the comparison, not part of any
 * proposal.
 */
export function DesignFrame({
  design,
  children,
}: {
  design: Design;
  children: ReactNode;
}) {
  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: tokens are authored constants, not input */}
      <style dangerouslySetInnerHTML={{ __html: themeCss(design) }} />

      <a href="#contenido" className="lab__skip">
        Saltar al contenido
      </a>

      <div className="lab__bar">
        <nav aria-label="Propuestas de diseño" className="lab__nav">
          <Link href="/design" className="lab__home">
            ← Propuestas
          </Link>
          <ul className="lab__list">
            {DESIGNS.map((d) => (
              <li key={d.slug}>
                <Link
                  href={`/design/${d.slug}`}
                  aria-current={d.slug === design.slug ? "page" : undefined}
                  className="lab__link"
                >
                  {d.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <ThemeControl />
      </div>

      <div data-design={design.slug} className="designRoot">
        {children}
      </div>
    </>
  );
}
