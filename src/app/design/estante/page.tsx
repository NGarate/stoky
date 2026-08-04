import { Bricolage_Grotesque, Source_Sans_3 } from "next/font/google";
import { DesignFrame } from "../_components/DesignFrame";
import { designBySlug } from "../_lib/tokens";
import {
  HOUSEHOLD,
  ITEMS,
  LOCATIONS,
  STATUS_LABEL,
  type StockItem,
  itemsAtLocation,
  soonestExpiry,
  statusOf,
  unshelvedItems,
} from "../_lib/fixture";
import "./estante.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--es-display",
});
const body = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--es-body",
});

/**
 * Gauge geometry. The track runs to 1.5× the minimum so "above the line" is
 * visible rather than merely full — a bar pinned at 100% tells you nothing
 * about how much headroom is left.
 */
function gauge(item: StockItem): { fill: number; notch: number } | null {
  if (item.minStock === null || item.minStock <= 0) return null;
  const max = item.minStock * 1.5;
  return {
    fill: Math.max(0, Math.min(100, (item.totalStock / max) * 100)),
    notch: (item.minStock / max) * 100,
  };
}

function StatusMark({ item }: { item: StockItem }) {
  const status = statusOf(item);
  const glyph =
    status === "ok" ? "M4 8.5l3 3 5-6" : status === "low" ? "M8 3v6" : "M4 4l8 8m0-8l-8 8";
  return (
    <span className={`es__status es__status--${status}`}>
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d={glyph} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        {status === "low" && <circle cx="8" cy="12" r="1" fill="currentColor" />}
      </svg>
      {STATUS_LABEL[status]}
    </span>
  );
}

function Item({ item }: { item: StockItem }) {
  const g = gauge(item);
  const expiry = soonestExpiry(item);
  return (
    <li className="es__item">
      <div className="es__itemMain">
        <h3 className="es__itemName">{item.name}</h3>
        <p className="es__itemMeta">
          {[item.brand, item.category].filter(Boolean).join(" · ") || "Sin categoría"}
        </p>
      </div>

      <div className="es__measure">
        {g ? (
          <>
            <div className="es__gauge" aria-hidden="true">
              <div className="es__gaugeFill" style={{ width: `${g.fill}%` }} />
              <div className="es__gaugeNotch" style={{ left: `${g.notch}%` }} />
            </div>
            <p className="es__qty">
              <strong>
                {item.totalStock} {item.defaultUnit}
              </strong>
              <span> · mínimo {item.minStock}</span>
            </p>
          </>
        ) : (
          <p className="es__qty">
            <strong>
              {item.totalStock} {item.defaultUnit}
            </strong>
            <span> · sin mínimo</span>
          </p>
        )}
      </div>

      <div className="es__side">
        <StatusMark item={item} />
        {expiry?.daysLeft !== undefined && expiry?.daysLeft !== null && expiry.daysLeft <= 7 && (
          <p className="es__expiry">Caduca en {expiry.daysLeft} días</p>
        )}
      </div>
    </li>
  );
}

export default function EstantePage() {
  const design = designBySlug("estante");
  if (!design) throw new Error("estante tokens missing");

  const lowCount = ITEMS.filter((i) => statusOf(i) !== "ok").length;
  const unshelved = unshelvedItems();

  return (
    <DesignFrame design={design}>
      <div className={`${display.variable} ${body.variable} es`}>
        <main id="contenido" className="es__page">
          <header className="es__head">
            <p className="es__eyebrow">{HOUSEHOLD}</p>
            <h1 className="es__title">Inventario</h1>
            <p className="es__lede">
              {ITEMS.length} productos en tres ubicaciones. {lowCount} necesitan
              reposición.
            </p>
            <div className="es__actions">
              <a className="es__btn es__btn--primary" href="/inventory/add">
                Añadir stock
              </a>
              <a className="es__btn" href="/inventory/consume">
                Consumir stock
              </a>
            </div>
          </header>

          {LOCATIONS.map((location) => {
            const items = itemsAtLocation(location);
            if (items.length === 0) return null;
            const id = `estante-${location.toLowerCase()}`;
            return (
              <section key={location} className="es__shelf" aria-labelledby={id}>
                <div className="es__shelfHead">
                  <h2 id={id} className="es__shelfName">
                    {location}
                  </h2>
                  <p className="es__shelfCount">
                    {items.length} {items.length === 1 ? "producto" : "productos"}
                  </p>
                </div>
                <ul className="es__items">
                  {items.map((item) => (
                    <Item key={item.id} item={item} />
                  ))}
                </ul>
              </section>
            );
          })}

          {unshelved.length > 0 && (
            <section className="es__shelf es__shelf--empty" aria-labelledby="estante-agotado">
              <div className="es__shelfHead">
                <h2 id="estante-agotado" className="es__shelfName">
                  Sin existencias
                </h2>
                <p className="es__shelfCount">No están en ninguna ubicación</p>
              </div>
              <ul className="es__items">
                {unshelved.map((item) => (
                  <Item key={item.id} item={item} />
                ))}
              </ul>
            </section>
          )}
        </main>
      </div>
    </DesignFrame>
  );
}
