import { IBM_Plex_Sans, Space_Grotesk } from "next/font/google";
import { DesignFrame } from "../_components/DesignFrame";
import { designBySlug } from "../_lib/tokens";
import {
  HOUSEHOLD,
  ITEMS,
  STATUS_LABEL,
  type StockItem,
  soonestExpiry,
  statusOf,
} from "../_lib/fixture";
import "./triaje.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--tr-display",
});
const body = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--tr-body",
});

const EXPIRY_HORIZON_DAYS = 7;

/** Why an item is on the worklist, and what to do about it. */
function reasonFor(item: StockItem): { reason: string; action: string } | null {
  const status = statusOf(item);
  const expiry = soonestExpiry(item);
  const expiringSoon = expiry?.daysLeft != null && expiry.daysLeft <= EXPIRY_HORIZON_DAYS;

  if (status === "out") {
    return { reason: "Se ha agotado", action: "Añadir a la lista" };
  }
  if (status === "low" && expiringSoon) {
    return {
      reason: `Queda poco y caduca en ${expiry?.daysLeft} días`,
      action: "Añadir a la lista",
    };
  }
  if (status === "low") {
    return {
      reason: `Por debajo del mínimo de ${item.minStock} ${item.defaultUnit}`,
      action: "Añadir a la lista",
    };
  }
  if (expiringSoon) {
    return { reason: `Caduca en ${expiry?.daysLeft} días`, action: "Consumir" };
  }
  return null;
}

function Card({ item }: { item: StockItem }) {
  const detail = reasonFor(item);
  if (!detail) return null;
  const status = statusOf(item);

  return (
    <li className={`tr__card tr__card--${status}`}>
      <div className="tr__cardTop">
        <h3 className="tr__cardName">{item.name}</h3>
        <span className={`tr__tag tr__tag--${status}`}>{STATUS_LABEL[status]}</span>
      </div>
      <p className="tr__reason">{detail.reason}</p>
      <p className="tr__figures">
        <strong>
          {item.totalStock} {item.defaultUnit}
        </strong>
        {item.minStock !== null && <span> de {item.minStock} necesarios</span>}
        {Object.values(item.stockByLocation)[0] && (
          <span> · {Object.values(item.stockByLocation)[0].locationName}</span>
        )}
      </p>
      <div className="tr__cardActions">
        <button type="button" className="tr__btn tr__btn--primary">
          {detail.action}
        </button>
        <button type="button" className="tr__btn">
          Ajustar stock
        </button>
      </div>
    </li>
  );
}

export default function TriajePage() {
  const design = designBySlug("triaje");
  if (!design) throw new Error("triaje tokens missing");

  const needsAttention = ITEMS.filter((i) => reasonFor(i) !== null);
  const settled = ITEMS.filter((i) => reasonFor(i) === null);

  return (
    <DesignFrame design={design}>
      <div className={`${display.variable} ${body.variable} tr`}>
        <main id="contenido" className="tr__page">
          <header className="tr__head">
            <p className="tr__eyebrow">{HOUSEHOLD}</p>
            <h1 className="tr__title">
              {needsAttention.length} cosas necesitan tu atención
            </h1>
            <p className="tr__lede">
              De {ITEMS.length} productos, {settled.length} están en orden y no
              piden nada. Empieza por arriba.
            </p>
          </header>

          <section aria-labelledby="tr-atencion">
            <h2 id="tr-atencion" className="tr__sectionTitle">
              Necesita atención
            </h2>
            <ul className="tr__cards">
              {needsAttention.map((item) => (
                <Card key={item.id} item={item} />
              ))}
            </ul>
          </section>

          {/* The signature: everything healthy collapses to one quiet line. */}
          <section aria-labelledby="tr-orden" className="tr__settled">
            <h2 id="tr-orden" className="tr__srOnly">
              Productos en orden
            </h2>
            <details className="tr__details">
              <summary className="tr__summary">
                <span className="tr__summaryMark" aria-hidden="true" />
                <span>
                  <strong>{settled.length} productos en orden</strong> — sin
                  acciones pendientes
                </span>
              </summary>
              <ul className="tr__settledList">
                {settled.map((item) => (
                  <li key={item.id} className="tr__settledItem">
                    <span className="tr__settledName">{item.name}</span>
                    <span className="tr__settledQty">
                      {item.totalStock} {item.defaultUnit}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </section>
        </main>
      </div>
    </DesignFrame>
  );
}
