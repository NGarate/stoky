import Link from "next/link";
import { DESIGNS } from "./_lib/tokens";

export default function DesignIndexPage() {
  return (
    <main className="labIndex">
      <header className="labIndex__head">
        <p className="labIndex__eyebrow">Stoky · propuestas de diseño</p>
        <h1>Cinco formas de leer el inventario</h1>
        <p className="labIndex__lede">
          Cada propuesta refactoriza la misma página —{" "}
          <code>/inventory</code> — con la misma información. No cambian los
          colores: cambia qué pregunta responde la página primero. Todas
          incluyen tema claro y oscuro y cumplen contraste WCAG AAA.
        </p>
      </header>

      <ol className="labIndex__list">
        {DESIGNS.map((design, index) => (
          <li key={design.slug} className="labIndex__item">
            <span className="labIndex__num">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <h2>
                <Link href={`/design/${design.slug}`}>{design.name}</Link>
              </h2>
              <p>{design.thesis}</p>
              <p className="labIndex__meta">
                <strong>Elemento distintivo:</strong> {design.signature}
              </p>
              <p className="labIndex__meta">
                <strong>Tipografía:</strong> {design.fonts}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
