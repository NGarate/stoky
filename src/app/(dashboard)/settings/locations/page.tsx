"use client";

import Link from "next/link";
import { api } from "@/lib/trpc/client";

interface LocationNode {
  id: string;
  name: string;
  children: LocationNode[];
  _count?: { stockEntries: number };
  parentId: string | null;
  householdId: string;
}

function LocationTree({
  locations,
  depth = 0,
}: {
  locations: LocationNode[];
  depth?: number;
}) {
  if (locations.length === 0) return null;

  return (
    <ul className={depth > 0 ? "ml-6 mt-2" : ""}>
      {locations.map((location) => (
        <li key={location.id} className="mb-2">
          <div className="flex items-center gap-2 p-2 bg-muted rounded">
            <span className="font-medium">{location.name}</span>
            {location._count && location._count.stockEntries > 0 && (
              <span className="text-sm text-muted-foreground">
                ({location._count.stockEntries} productos)
              </span>
            )}
          </div>
          <LocationTree locations={location.children} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
}

export default function LocationsPage() {
  const { data: locations, isLoading } = api.location.getTree.useQuery();

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6 text-heading">Ubicaciones de Almacenamiento</h1>
        <div className="space-y-4">
          {['skeleton-1', 'skeleton-2', 'skeleton-3'].map((key) => (
            <div key={key} className="h-12 bg-muted rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-heading">Ubicaciones de Almacenamiento</h1>
        <Link
          href="/settings"
          className="text-primary hover:underline"
        >
          ← Volver a configuración
        </Link>
      </div>

      <div className="mb-6 rounded-lg border border-border bg-muted p-4">
        <p className="text-sm text-muted-foreground">
          Las ubicaciones se usan para organizar dónde guardas tus productos.
          Puedes crear una estructura jerárquica (por ejemplo: Nevera → Estante
          superior).
        </p>
      </div>

      {!locations || locations.length === 0 ? (
        <div className="text-center p-8 bg-muted rounded-lg">
          <p className="text-foreground mb-4">
            No hay ubicaciones configuradas.
          </p>
          <p className="text-sm text-muted-foreground">
            Las ubicaciones se pueden crear al añadir stock a un producto.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-6 shadow">
          <LocationTree locations={locations as LocationNode[]} />
        </div>
      )}
    </div>
  );
}
