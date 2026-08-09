"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "@/lib/trpc/client";

interface LocationPickerProps {
  value?: string;
  onChange: (locationId: string | undefined) => void;
  placeholder?: string;
  allowRoot?: boolean;
  /**
   * Id of the element that names the control. `role="combobox"` does not take
   * its name from its own contents — those are the *value* — so without this
   * the trigger is an unnamed input field.
   */
  labelledBy?: string;
}

interface LocationNode {
  id: string;
  name: string;
  children: LocationNode[];
  stockCount?: number;
}

/** One row of the listbox, in the order the arrow keys walk them. */
interface LocationOption {
  /** Stable key, also the suffix of the DOM id `aria-activedescendant` points at. */
  key: string;
  /** `undefined` for the "no location" row. */
  locationId: string | undefined;
  name: string;
  /** Ancestors outermost first — what the indentation shows, spelled out. */
  ancestors: string[];
  stockCount?: number;
  selectable: boolean;
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

/**
 * Depth-first walk, so a parent is immediately followed by its own subtree.
 *
 * A listbox is flat by definition: the nesting cannot live in the DOM shape the
 * way it does in a tree, so it is carried per option as `ancestors` and shown
 * twice — as indentation, and as a spoken "Cocina → Nevera". A picker that
 * offers two rows both reading "Nevera" is not a fix for UI-2.
 */
function flattenTree(
  nodes: LocationNode[],
  ancestors: string[] = []
): LocationOption[] {
  return nodes.flatMap((node) => [
    {
      key: node.id,
      locationId: node.id,
      name: node.name,
      ancestors,
      stockCount: node.stockCount,
      selectable: true,
    },
    ...flattenTree(node.children, [...ancestors, node.name]),
  ]);
}

function optionLabel(option: LocationOption): string {
  const count =
    option.stockCount && option.stockCount > 0 ? ` (${option.stockCount})` : "";
  return [...option.ancestors, `${option.name}${count}`].join(" → ");
}

export function LocationPicker({
  value,
  onChange,
  placeholder = "Seleccionar ubicación",
  allowRoot = true,
  labelledBy,
}: LocationPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const listboxId = useId();
  const { data: locations, isLoading } = api.location.list.useQuery();

  const options = useMemo<LocationOption[]>(() => {
    const tree = locations ? buildLocationTree(locations) : [];
    const flattened = flattenTree(tree);

    if (allowRoot) {
      flattened.unshift({
        key: "__none__",
        locationId: undefined,
        name: "Sin ubicación específica",
        ancestors: [],
        selectable: true,
      });
    }

    // `role="listbox"` requires at least one `option` child, so the empty state
    // is a row rather than an empty panel — it is just not choosable.
    if (flattened.length === 0) {
      flattened.push({
        key: "__empty__",
        locationId: undefined,
        name: "No hay ubicaciones",
        ancestors: [],
        selectable: false,
      });
    }

    return flattened;
  }, [locations, allowRoot]);

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.locationId === value),
    [options, value]
  );

  const selectedOption = useMemo(
    () =>
      value ? options.find((option) => option.locationId === value) : undefined,
    [options, value]
  );

  const close = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  const open = useCallback(
    (index: number) => {
      setActiveIndex(Math.min(Math.max(index, 0), options.length - 1));
      setIsOpen(true);
    },
    [options.length]
  );

  const choose = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option?.selectable) return;
      onChange(option.locationId);
      close();
    },
    [close, onChange, options]
  );

  // Focus never leaves the trigger while the panel is open — that is what
  // `aria-activedescendant` buys, and it is why Escape has nothing to restore.
  // So the key handling belongs on the trigger rather than on the document,
  // unlike NavSheet, whose focus moves into the panel it opens.
  const handleTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (!isOpen) {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(selectedIndex >= 0 ? selectedIndex : 0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        open(selectedIndex >= 0 ? selectedIndex : options.length - 1);
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, options.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(activeIndex);
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        // Not prevented: Tab dismisses and moves on, as it does in a <select>.
        setIsOpen(false);
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, isOpen]);

  if (isLoading) {
    return (
      <div className="w-full rounded border border-border bg-muted p-2 text-muted-foreground">
        Cargando ubicaciones...
      </div>
    );
  }

  const activeOptionId = isOpen
    ? `${listboxId}-${options[activeIndex]?.key ?? ""}`
    : undefined;

  return (
    <div className="relative">
      {/* 48px, not the 40 that `p-2` produced: WCAG 2.5.5 (AAA) asks for 44 and
          the phone is the tier where a thumb is expected (DESIGN_AUDIT A4.2,
          which named this trigger). `pr-8` keeps the label clear of the chevron
          that is absolutely positioned over the right-hand edge. */}
      <button
        type="button"
        ref={triggerRef}
        role="combobox"
        aria-controls={isOpen ? listboxId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-activedescendant={activeOptionId}
        aria-labelledby={labelledBy}
        // Callers that name the control pass `labelledBy`; the fallback keeps a
        // stand-alone picker from being an unnamed field.
        aria-label={labelledBy ? undefined : "Ubicación"}
        onClick={() => (isOpen ? close() : open(selectedIndex >= 0 ? selectedIndex : 0))}
        onKeyDown={handleTriggerKeyDown}
        className="flex min-h-[48px] w-full items-center rounded border border-input bg-card px-3 py-2 pr-8 text-left text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {selectedOption ? (
          <span>{optionLabel(selectedOption)}</span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <svg
          className={`absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
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
          {/* Decorative scrim, as in NavSheet: the trigger is still there to
              close the panel and Escape still works, so this stays out of the
              tab order and out of the accessibility tree rather than being a
              second, invisible "Close dropdown" control on every page that
              renders a picker (UI-4). */}
          <div
            aria-hidden="true"
            className="fixed inset-0 z-10"
            onClick={close}
          />
          <div
            id={listboxId}
            role="listbox"
            aria-label={placeholder}
            // Keeps the trigger focused through a mouse selection, so the
            // keyboard still works afterwards and Escape has somewhere to go.
            onMouseDown={(event) => event.preventDefault()}
            className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded border border-border bg-card shadow-lg"
          >
            {options.map((option, index) => {
              const isSelected = option.selectable && index === selectedIndex;
              const isActive = index === activeIndex;

              return (
                <div
                  key={option.key}
                  id={`${listboxId}-${option.key}`}
                  role="option"
                  aria-selected={option.selectable ? isSelected : undefined}
                  aria-disabled={option.selectable ? undefined : true}
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  onClick={() => choose(index)}
                  // The outline is inset because the panel scrolls: an outset
                  // one on the first or last row is clipped by the overflow.
                  className={`flex min-h-[48px] cursor-pointer items-center py-2 pr-3 ${
                    isActive ? "outline-2 -outline-offset-2 outline-ring" : ""
                  } ${
                    isSelected
                      ? "bg-accent font-semibold text-accent-foreground"
                      : "text-foreground hover:bg-muted"
                  }`}
                  style={{ paddingLeft: `${0.75 + option.ancestors.length * 1.25}rem` }}
                >
                  {/* The indentation is the visual half of the depth; this is
                      the half a screen reader gets. */}
                  {option.ancestors.length > 0 && (
                    <span className="sr-only">
                      {option.ancestors.join(" → ")} →{" "}
                    </span>
                  )}
                  {option.name}
                  {option.stockCount && option.stockCount > 0
                    ? ` (${option.stockCount})`
                    : ""}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
