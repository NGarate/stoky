/**
 * Demo data for the design proposals.
 *
 * Mirrors the shape of `api.inventory.getStockOverview` and the values the
 * seeder produces, so a proposal can be adopted by swapping this import for the
 * live query without touching the layout. Kept static so the five proposals can
 * be compared against identical content, and so screenshots are reproducible.
 */

export interface StockEntry {
  id: string;
  quantity: number;
  locationName: string | null;
  /** Days until expiry. null when the item does not expire. */
  daysLeft: number | null;
  /** Pre-formatted for display; a live page derives this from expirationDate. */
  expiresOn: string | null;
}

export interface StockItem {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  defaultUnit: string;
  minStock: number | null;
  totalStock: number;
  isLowStock: boolean;
  stockByLocation: Record<string, { locationName: string; quantity: number }>;
  entries: StockEntry[];
}

export const HOUSEHOLD = "Hogar Demo";

export const ITEMS: StockItem[] = [
  {
    id: "leche",
    name: "Leche entera",
    brand: "Hacendado",
    category: "Lácteos",
    defaultUnit: "L",
    minStock: 6,
    totalStock: 2,
    isLowStock: true,
    stockByLocation: { nevera: { locationName: "Nevera", quantity: 2 } },
    entries: [
      { id: "leche-1", quantity: 2, locationName: "Nevera", daysLeft: 5, expiresOn: "9 ago" },
    ],
  },
  {
    id: "aceite",
    name: "Aceite de oliva virgen extra",
    brand: "Carbonell",
    category: "Despensa",
    defaultUnit: "L",
    minStock: 2,
    totalStock: 1,
    isLowStock: true,
    stockByLocation: { despensa: { locationName: "Despensa", quantity: 1 } },
    entries: [
      { id: "aceite-1", quantity: 1, locationName: "Despensa", daysLeft: 300, expiresOn: "31 may" },
    ],
  },
  {
    id: "cafe",
    name: "Café molido natural",
    brand: "Marcilla",
    category: "Desayuno",
    defaultUnit: "paquete",
    minStock: 2,
    totalStock: 0,
    isLowStock: true,
    stockByLocation: {},
    entries: [],
  },
  {
    id: "huevos",
    name: "Huevos frescos",
    brand: null,
    category: "Frescos",
    defaultUnit: "docena",
    minStock: 1,
    totalStock: 2,
    isLowStock: false,
    stockByLocation: { nevera: { locationName: "Nevera", quantity: 2 } },
    entries: [
      { id: "huevos-1", quantity: 2, locationName: "Nevera", daysLeft: 3, expiresOn: "7 ago" },
    ],
  },
  {
    id: "arroz",
    name: "Arroz redondo",
    brand: "SOS",
    category: "Despensa",
    defaultUnit: "kg",
    minStock: 2,
    totalStock: 5,
    isLowStock: false,
    stockByLocation: { despensa: { locationName: "Despensa", quantity: 5 } },
    entries: [
      { id: "arroz-1", quantity: 5, locationName: "Despensa", daysLeft: 400, expiresOn: "8 sep" },
    ],
  },
  {
    id: "papel",
    name: "Papel higiénico",
    brand: "Scottex",
    category: "Hogar",
    defaultUnit: "paquete",
    minStock: 1,
    totalStock: 3,
    isLowStock: false,
    stockByLocation: { trastero: { locationName: "Trastero", quantity: 3 } },
    entries: [
      { id: "papel-1", quantity: 3, locationName: "Trastero", daysLeft: null, expiresOn: null },
    ],
  },
];

export type Status = "out" | "low" | "ok";

export function statusOf(item: StockItem): Status {
  if (item.totalStock <= 0) return "out";
  if (item.isLowStock) return "low";
  return "ok";
}

/** Spanish label for a status. Text, never colour alone. */
export const STATUS_LABEL: Record<Status, string> = {
  out: "Sin stock",
  low: "Stock bajo",
  ok: "Suficiente",
};

/** Soonest expiry across an item's entries, or null. */
export function soonestExpiry(item: StockItem): StockEntry | null {
  const dated = item.entries.filter((e) => e.daysLeft !== null);
  if (dated.length === 0) return null;
  return dated.reduce((a, b) => ((a.daysLeft ?? 0) <= (b.daysLeft ?? 0) ? a : b));
}

/** How much of the minimum is covered, clamped to 0–1. 1 when no minimum is set. */
export function fillRatio(item: StockItem): number {
  if (item.minStock === null || item.minStock <= 0) return 1;
  return Math.max(0, Math.min(1, item.totalStock / item.minStock));
}

export const LOCATIONS = ["Nevera", "Despensa", "Trastero"] as const;

export function itemsAtLocation(location: string): StockItem[] {
  return ITEMS.filter((item) =>
    Object.values(item.stockByLocation).some((l) => l.locationName === location),
  );
}

/** Items with no stock anywhere — they belong to no shelf. */
export function unshelvedItems(): StockItem[] {
  return ITEMS.filter((item) => Object.keys(item.stockByLocation).length === 0);
}
