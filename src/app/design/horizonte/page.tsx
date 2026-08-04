import { JetBrains_Mono, Manrope } from "next/font/google";
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
import "./horizonte.css";

const body = Manrope({
  subsets: ["latin"],
  weight: ["400", "600", "800"],
  variable: "--ho-body",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--ho-mono",
});

interface Band {
  id: string;
  label: string;
  note: string;
  test: (days: number | null) => boolean;
}

/**
 * Time bands, nearest first. An item sits in the band of its soonest expiry,
 * so the page reads top-to-bottom as "what to use first".
 */
const BANDS: Band[] = [
  {
    id: "semana",
    label: "Esta semana",
    note: "Úsalo antes de que se pierda",
    test: (d) => d !== null && d <= 7,
  },
  {
    id: "mes",
    label: "Este mes",
    note: "Tiempo de sobra, pero no lo olvides",
    test: (d) => d !== null && d > 7 && d <= 31,
  },
  {
    id: "despues",
    label: "Más adelante",
    note: "Larga duración",
    test: (d) => d !== null && d > 31,
  },
  {
    id: "estable",
    label: "Sin caducidad",
    note: "No se estropea",
    test: (d) => d === null,
  },
];

function Row({ item }: { item: StockItem }) {
  const expiry = soonestExpiry(item);
  const status = statusOf(item);
  const days = expiry?.daysLeft ?? null;

  return (
    <li className="ho__row">
      <div className="ho__marker" aria-hidden="true">
        <span className="ho__dot" />
      </div>
      <div className="ho__when">
        <p className="ho__days">
          {days === null ? "—" : <>{days}<span> d</span></>}
        </p>
        {expiry?.expiresOn && <p className="ho__date">{expiry.expiresOn}</p>}
      </div>
      <div className="ho__what">
        <h3 className="ho__name">{item.name}</h3>
        <p className="ho__meta">
          <span className="ho__qty">
            {item.totalStock} {item.defaultUnit}
          </span>
          {" · "}
          {Object.values(item.stockByLocation)[0]?.locationName ?? "Sin ubicación"}
          {status !== "ok" && (
            <>
              {" · "}
              <span className={`ho__flag ho__flag--${status}`}>
                {STATUS_LABEL[status]}
              </span>
            </>
          )}
        </p>
      </div>
    </li>
  );
}

export default function HorizontePage() {
  const design = designBySlug("horizonte");
  if (!design) throw new Error("horizonte tokens missing");

  const sorted = [...ITEMS].sort((a, b) => {
    const da = soonestExpiry(a)?.daysLeft;
    const db = soonestExpiry(b)?.daysLeft;
    if (da == null && db == null) return a.name.localeCompare(b.name, "es");
    if (da == null) return 1;
    if (db == null) return -1;
    return da - db;
  });

  // An item with no stock has no freshness — it belongs to its own band
  // rather than sitting under "sin caducidad", which would read as "keeps
  // forever" when the truth is "there is none".
  const gone = sorted.filter((i) => statusOf(i) === "out");
  const inStock = sorted.filter((i) => statusOf(i) !== "out");

  const urgent = inStock.filter((i) => {
    const d = soonestExpiry(i)?.daysLeft;
    return d !== undefined && d !== null && d <= 7;
  }).length;

  return (
    <DesignFrame design={design}>
      <div className={`${body.variable} ${mono.variable} ho`}>
        <main id="contenido" className="ho__page">
          <header className="ho__head">
            <p className="ho__eyebrow">{HOUSEHOLD}</p>
            <h1 className="ho__title">Qué gastar primero</h1>
            <p className="ho__lede">
              El inventario ordenado por lo que caduca antes.{" "}
              {urgent > 0
                ? `${urgent} productos piden salida esta semana.`
                : "Nada urgente esta semana."}
            </p>
          </header>

          {/* The signature: one continuous rail, distance encodes time. */}
          <div className="ho__rail">
            {gone.length > 0 && (
              <section className="ho__band" aria-labelledby="ho-agotado">
                <div className="ho__bandHead">
                  <h2 id="ho-agotado" className="ho__bandName">
                    Se ha agotado
                  </h2>
                  <p className="ho__bandNote">
                    No queda nada — no está en el horizonte
                  </p>
                </div>
                <ul className="ho__rows">
                  {gone.map((item) => (
                    <Row key={item.id} item={item} />
                  ))}
                </ul>
              </section>
            )}

            {BANDS.map((band) => {
              const items = inStock.filter((item) =>
                band.test(soonestExpiry(item)?.daysLeft ?? null),
              );
              if (items.length === 0) return null;
              return (
                <section key={band.id} className="ho__band" aria-labelledby={`ho-${band.id}`}>
                  <div className="ho__bandHead">
                    <h2 id={`ho-${band.id}`} className="ho__bandName">
                      {band.label}
                    </h2>
                    <p className="ho__bandNote">{band.note}</p>
                  </div>
                  <ul className="ho__rows">
                    {items.map((item) => (
                      <Row key={item.id} item={item} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </main>
      </div>
    </DesignFrame>
  );
}
