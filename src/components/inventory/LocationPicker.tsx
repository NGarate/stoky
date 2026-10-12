"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "@/lib/trpc/client";
import { drawnParents } from "@/lib/inventory/location-tree";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

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

  // Second pass: build hierarchy. By reachability, as `location.getTree`
  // does: an orphan or a loop of locations inside each other (ISSUES.md
  // LOC-1) is offered at the top level. Attaching by "has a parent" dropped
  // both, so a location that existed could not be chosen — and the result is
  // now a forest, which is what lets `flattenTree` recurse without a guard.
  const drawn = drawnParents(locations);
  for (const loc of locations) {
    const node = map.get(loc.id);
    if (!node) continue;

    const parentId = drawn.get(loc.id) ?? null;
    const parent = parentId ? map.get(parentId) : undefined;
    if (parent) {
      parent.children.push(node);
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

/** Breathing room between the trigger and the panel, in CSS pixels. */
const GAP = 4;
/** Two rows and a hint of a third, so the panel always reads as a list. */
const MIN_PANEL = 120;
/** What the panel asks for when there is room: the old `max-h-60`. */
const DEFAULT_PANEL = 240;

function optionLabel(option: LocationOption): string {
  const count =
    option.stockCount && option.stockCount > 0 ? ` (${option.stockCount})` : "";
  return [...option.ancestors, `${option.name}${count}`].join(" → ");
}

export function LocationPicker({
  value,
  onChange,
  placeholder,
  allowRoot = true,
  labelledBy,
}: LocationPickerProps) {
  const t = useTranslations("inventory");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState({
    dropUp: false,
    maxHeight: DEFAULT_PANEL,
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const listboxId = useId();
  // A default argument cannot call a hook, so the fallback moves here. Callers
  // that pass their own wording still win.
  const prompt = placeholder ?? t("locationPlaceholder");
  const { data: locations, isLoading } = api.location.list.useQuery();

  const options = useMemo<LocationOption[]>(() => {
    const tree = locations ? buildLocationTree(locations) : [];
    const flattened = flattenTree(tree);

    if (allowRoot) {
      flattened.unshift({
        key: "__none__",
        locationId: undefined,
        name: t("locationNone"),
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
        name: t("locationEmpty"),
        ancestors: [],
        selectable: false,
      });
    }

    return flattened;
  }, [locations, allowRoot, t]);

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

  // Where the panel fits, recomputed while it is open (ISSUES UI-6).
  //
  // It used to open downward unconditionally. On a phone the picker is the last
  // field of a long form, so "downward" meant into the 64px left under the fixed
  // bottom bar: measured, the last option ended at 892px on an 844px viewport
  // and not one row was visible. The bar is `position: fixed`, so scrolling the
  // page does not help — the floor has to be the top of that element, not the
  // bottom of the viewport.
  // No dependency array: this runs after every render while the panel is open,
  // which is two `getBoundingClientRect` calls and is the price of not having to
  // be right about *when* to measure. The version that measured once, keyed on
  // `isOpen`, painted the default placement in about one run in three — the
  // trigger's position is settled by a scroll that the effect cannot see coming.
  // `useLayoutEffect` so the decision lands before the browser paints, rather
  // than as a visible jump from below to above.
  useLayoutEffect(() => {
    if (!isOpen) return;

    function place(): void {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();

      // Whatever the shell has parked across the bottom of the viewport. Absent
      // from `md` up, where the navigation is a rail and then a top bar.
      const bar = document.querySelector<HTMLElement>("[data-fixed-bottom]");
      const barRect = bar?.getBoundingClientRect();
      const floor =
        barRect && barRect.height > 0 ? barRect.top : window.innerHeight;

      const below = floor - rect.bottom - GAP;
      const above = rect.top - GAP;

      // Prefer downward, as a `<select>` does, and only flip when the panel
      // would be more usable the other way round. The height is capped either
      // way: a panel that runs off the screen is the defect, whichever
      // direction it runs off in.
      // Prefer downward, as a `<select>` does, and flip only when downward is
      // too cramped and upward is genuinely roomier.
      const dropUp = below < MIN_PANEL && above > below;

      // Capped by the room on the side actually chosen, never floored past it.
      // A floor was the first attempt and it reintroduced the defect in
      // miniature: with 100px below and 90px above, neither side clears
      // MIN_PANEL, so it stayed below and a 120px panel hung 20px under the bar.
      // A short panel that scrolls is recoverable; one drawn under the
      // navigation is the bug.
      const room = Math.max(Math.round(dropUp ? above : below), 0);
      setPlacement((current) => {
        const next = { dropUp, maxHeight: Math.min(DEFAULT_PANEL, room) };
        return current.dropUp === next.dropUp &&
          current.maxHeight === next.maxHeight
          ? current
          : next;
      });
    }

    place();
    window.addEventListener("resize", place);
    // Capture, so it also fires for a scrollable ancestor rather than only the
    // document.
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  });

  if (isLoading) {
    return (
      <div className="w-full rounded border border-border bg-muted p-2 text-muted-foreground">
        {t("locationLoading")}
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
        aria-label={labelledBy ? undefined : t("locationLabel")}
        onClick={() => (isOpen ? close() : open(selectedIndex >= 0 ? selectedIndex : 0))}
        onKeyDown={handleTriggerKeyDown}
        className="flex min-h-[48px] w-full items-center rounded border border-input bg-card px-3 py-2 pr-8 text-left text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {selectedOption ? (
          <span>{optionLabel(selectedOption)}</span>
        ) : (
          <span className="text-muted-foreground">{prompt}</span>
        )}
        <ChevronDown
          aria-hidden="true"
          className={`absolute right-2 top-1/2 size-5 -translate-y-1/2 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
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
            aria-label={prompt}
            // Keeps the trigger focused through a mouse selection, so the
            // keyboard still works afterwards and Escape has somewhere to go.
            onMouseDown={(event) => event.preventDefault()}
            data-placement={placement.dropUp ? "above" : "below"}
            style={{ maxHeight: `${placement.maxHeight}px` }}
            className={`absolute z-20 w-full overflow-auto rounded border border-border bg-card shadow-lg ${
              placement.dropUp ? "bottom-full mb-1" : "top-full mt-1"
            }`}
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
