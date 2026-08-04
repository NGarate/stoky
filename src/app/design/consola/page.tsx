import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
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
import "./consola.css";

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--co-mono",
});
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--co-sans",
});

const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: "/", action: "Buscar" },
  { keys: "A", action: "Añadir stock" },
  { keys: "C", action: "Consumir" },
  { keys: "L", action: "Ver solo bajos" },
];

function Row({ item }: { item: StockItem }) {
  const status = statusOf(item);
  const expiry = soonestExpiry(item);
  const where = Object.values(item.stockByLocation)[0]?.locationName ?? "—";

  return (
    <tr className={status !== "ok" ? "co__tr co__tr--flag" : "co__tr"}>
      <th scope="row" className="co__cellName">
        {item.name}
        {item.brand && <span className="co__brand"> {item.brand}</span>}
      </th>
      <td className="co__cellLoc">{where}</td>
      <td className="co__cellNum">
        {item.totalStock}
        <span className="co__unit"> {item.defaultUnit}</span>
      </td>
      <td className="co__cellNum co__cellMin">
        {item.minStock === null ? "—" : item.minStock}
      </td>
      <td className="co__cellNum">
        {expiry?.daysLeft == null ? "—" : `${expiry.daysLeft} d`}
      </td>
      <td className="co__cellStatus">
        <span className={`co__badge co__badge--${status}`}>
          <span className="co__badgeGlyph" aria-hidden="true">
            {status === "ok" ? "+" : status === "low" ? "!" : "×"}
          </span>
          {STATUS_LABEL[status]}
        </span>
      </td>
    </tr>
  );
}

export default function ConsolaPage() {
  const design = designBySlug("consola");
  if (!design) throw new Error("consola tokens missing");

  const low = ITEMS.filter((i) => statusOf(i) !== "ok").length;

  return (
    <DesignFrame design={design}>
      <div className={`${mono.variable} ${sans.variable} co`}>
        <main id="contenido" className="co__page">
          <header className="co__head">
            <div className="co__headRow">
              <h1 className="co__title">inventario</h1>
              <p className="co__household">{HOUSEHOLD}</p>
            </div>
            <p className="co__summary">
              <span>{ITEMS.length} productos</span>
              <span aria-hidden="true">·</span>
              <span>{low} por debajo del mínimo</span>
            </p>
          </header>

          <div className="co__search">
            <label htmlFor="co-q" className="co__searchLabel">
              Buscar o escribir un comando
            </label>
            <div className="co__searchField">
              <span className="co__prompt" aria-hidden="true">
                &gt;
              </span>
              <input
                id="co-q"
                type="search"
                className="co__input"
                placeholder="leche, despensa, bajo…"
                autoComplete="off"
              />
              <kbd className="co__kbd">/</kbd>
            </div>
          </div>

          <table className="co__table">
            <caption className="co__caption">
              Existencias por producto. Ordenado alfabéticamente.
            </caption>
            <thead>
              <tr>
                <th scope="col">Producto</th>
                <th scope="col">Ubicación</th>
                <th scope="col" className="co__thNum">
                  Stock
                </th>
                <th scope="col" className="co__thNum">
                  Mín.
                </th>
                <th scope="col" className="co__thNum">
                  Caduca
                </th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {[...ITEMS]
                .sort((a, b) => a.name.localeCompare(b.name, "es"))
                .map((item) => (
                  <Row key={item.id} item={item} />
                ))}
            </tbody>
          </table>

          {/* The signature: every action states its key. */}
          <footer className="co__legend">
            <h2 className="co__legendTitle">Atajos</h2>
            <ul className="co__shortcuts">
              {SHORTCUTS.map((s) => (
                <li key={s.keys}>
                  <kbd className="co__kbd">{s.keys}</kbd>
                  <span>{s.action}</span>
                </li>
              ))}
            </ul>
          </footer>
        </main>
      </div>
    </DesignFrame>
  );
}
