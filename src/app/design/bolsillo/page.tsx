import { Nunito_Sans, Outfit } from "next/font/google";
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
import { Stepper } from "./Stepper";
import "./bolsillo.css";

const display = Outfit({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--bo-display",
});
const body = Nunito_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--bo-body",
});

function Card({ item }: { item: StockItem }) {
  const status = statusOf(item);
  const expiry = soonestExpiry(item);
  const where = Object.values(item.stockByLocation)[0]?.locationName;

  return (
    <li className="bo__card">
      <div className="bo__cardHead">
        <h3 className="bo__name">{item.name}</h3>
        <span className={`bo__pill bo__pill--${status}`}>
          <span className="bo__pillDot" aria-hidden="true" />
          {STATUS_LABEL[status]}
        </span>
      </div>

      <p className="bo__meta">
        {[item.brand, where ?? "Sin ubicación"].filter(Boolean).join(" · ")}
      </p>

      <Stepper label={item.name} unit={item.defaultUnit} initial={item.totalStock} />

      <dl className="bo__facts">
        <div>
          <dt>Mínimo</dt>
          <dd>
            {item.minStock === null ? "—" : `${item.minStock} ${item.defaultUnit}`}
          </dd>
        </div>
        <div>
          <dt>Caduca</dt>
          <dd>
            {expiry?.daysLeft == null
              ? "No caduca"
              : `${expiry.expiresOn} · ${expiry.daysLeft} días`}
          </dd>
        </div>
      </dl>
    </li>
  );
}

export default function BolsilloPage() {
  const design = designBySlug("bolsillo");
  if (!design) throw new Error("bolsillo tokens missing");

  const attention = ITEMS.filter((i) => statusOf(i) !== "ok").length;

  return (
    <DesignFrame design={design}>
      <div className={`${display.variable} ${body.variable} bo`}>
        <main id="contenido" className="bo__page">
          <header className="bo__head">
            <p className="bo__eyebrow">{HOUSEHOLD}</p>
            <h1 className="bo__title">Inventario</h1>
            <p className="bo__lede">
              Toca − o + para ajustar lo que hay. Los cambios se guardan solos.
            </p>
            <p className="bo__count">
              <strong>{ITEMS.length}</strong> productos ·{" "}
              <strong>{attention}</strong> por reponer
            </p>
          </header>

          <ul className="bo__grid">
            {ITEMS.map((item) => (
              <Card key={item.id} item={item} />
            ))}
          </ul>
        </main>
      </div>
    </DesignFrame>
  );
}
