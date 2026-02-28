"use client";

import { useState, useMemo } from "react";
import { api } from "@/lib/trpc/client";

interface LocationPickerProps {
  value?: string;
  onChange: (locationId: string | undefined) => void;
  placeholder?: string;
  allowRoot?: boolean;
}

interface LocationNode {
  id: string;
  name: string;
  children: LocationNode[];
  stockCount?: number;
}

function buildLocationTree(
  locations: Array<{
    id: string;
    name: string;
    parentId: string | null;
    _count?: { stockEntries: number };
  }>
): LocationNode[] {
  const map = new Map<string, LocationNode>();
  const roots: LocationNode[] = [];

  // First pass: create all nodes
  for (const loc of locations) {
    map.set(loc.id, {
      id: loc.id,
      name: loc.name,
      children: [],
      stockCount: loc._count?.stockEntries,
    });
  }

  // Second pass: build hierarchy
  for (const loc of locations) {
    const node = map.get(loc.id);
    if (!node) continue;

    if (loc.parentId) {
      const parent = map.get(loc.parentId);
      if (parent) {
        parent.children.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function LocationPicker({
  value,
  onChange,
  placeholder = "Seleccionar ubicación",
  allowRoot = true,
}: LocationPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { data: locations, isLoading } = api.location.list.useQuery();

  const locationTree = useMemo(() => {
    if (!locations) return [];
    return buildLocationTree(locations);
  }, [locations]);

  const selectedLocation = useMemo(() => {
    if (!value || !locations) return null;
    return locations.find((loc) => loc.id === value);
  }, [value, locations]);

  if (isLoading) {
    return (
      <div className="w-full p-2 border rounded bg-gray-50 text-gray-500">
        Cargando ubicaciones...
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-2 border rounded text-left bg-white hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      >
        {selectedLocation ? (
          <span>{selectedLocation.name}</span>
        ) : (
          <span className="text-gray-500">{placeholder}</span>
        )}
        <svg
          className={`absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <title>Toggle dropdown</title>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                setIsOpen(false);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Close dropdown"
          />
          <div className="absolute z-20 w-full mt-1 bg-white border rounded shadow-lg max-h-60 overflow-auto">
            {allowRoot && (
              <button
                type="button"
                onClick={() => {
                  onChange(undefined);
                  setIsOpen(false);
                }}
                className={`w-full p-2 text-left hover:bg-gray-100 ${
                  !value ? "bg-blue-50 text-blue-700" : ""
                }`}
              >
                Sin ubicación específica
              </button>
            )}
            {locationTree.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => {
                  onChange(node.id);
                  setIsOpen(false);
                }}
                className={`w-full p-2 text-left hover:bg-gray-100 ${
                  value === node.id ? "bg-blue-50 text-blue-700" : ""
                }`}
              >
                {node.name}
        {node.stockCount && node.stockCount > 0 ? ` (${node.stockCount})` : ""}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
