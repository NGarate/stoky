"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** The most rows the panel offers; it scrolls, and typing narrows the rest in. */
const MAX_SHOWN = 50;
/** Below this much room under the field, the panel opens upward instead. */
const MIN_ROOM = 160;

/**
 * "Café" finds "cafe", and "LECHE" finds "Leche". Exported so a caller that
 * maps the chosen text back to a record matches it the way the panel did.
 */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** The options worth offering for what has been typed, in the order given. */
export function matchingOptions(
  options: readonly string[],
  typed: string,
): string[] {
  const needle = foldText(typed);
  const seen = new Set<string>();
  const matches: string[] = [];

  for (const option of options) {
    const key = foldText(option);
    // "Hacendado" and "hacendado" are one brand typed twice, not two choices.
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    if (key.includes(needle)) matches.push(option);
    if (matches.length === MAX_SHOWN) break;
  }

  return matches;
}

export interface ComboboxProps extends Omit<
  InputProps,
  "value" | "onChange" | "list" | "role" | "type"
> {
  value: string;
  onValueChange: (value: string) => void;
  /** What the household has already used, most used first. */
  options: readonly string[];
  /** Names the panel of suggestions, already translated. */
  listLabel: string;
}

/**
 * A text field that suggests what already exists and accepts anything else.
 *
 * For the fields whose values a household invents — a brand, a category, a
 * unit, a shop — where a `<select>` would refuse the first new one and a bare
 * `<Input>` let the same brand be spelled three ways. Typing narrows the
 * suggestions; a value no suggestion matches is simply the value, with
 * nothing to confirm.
 *
 * Not `<datalist>`: Firefox for Android never shows one, and the phone is the
 * tier this is for. The pattern is the ARIA editable combobox with list
 * autocomplete, so focus stays in the field and the suggestion under the
 * arrow keys is announced through `aria-activedescendant`, as in
 * `LocationPicker`. Enter takes the highlighted suggestion; with none
 * highlighted it submits the form as any other field would.
 */
const Combobox = React.forwardRef<HTMLInputElement, ComboboxProps>(
  (
    {
      value,
      onValueChange,
      options,
      listLabel,
      className,
      onBlur,
      onFocus,
      onKeyDown,
      ...props
    },
    ref,
  ) => {
    const listboxId = React.useId();
    const wrapperRef = React.useRef<HTMLDivElement>(null);
    const [isOpen, setIsOpen] = React.useState(false);
    // Whether the panel narrows to what is in the field. Not until the person
    // types: opened on a prefilled "unit", a filtered panel would offer "unit"
    // and nothing else, where a `<select>` would show every choice.
    const [filtering, setFiltering] = React.useState(false);
    const [activeIndex, setActiveIndex] = React.useState(-1);
    const [dropUp, setDropUp] = React.useState(false);

    const shown = React.useMemo(
      () => matchingOptions(options, filtering ? value : ""),
      [options, value, filtering],
    );
    // Nothing to suggest is a closed panel, never an empty one: an empty
    // `listbox` is invalid, and a free-text value needs no confirmation.
    const expanded = isOpen && shown.length > 0;

    function open(filter: boolean, index = -1): void {
      setFiltering(filter);
      setActiveIndex(index);
      setIsOpen(true);
    }

    function choose(option: string): void {
      onValueChange(option);
      setIsOpen(false);
      setActiveIndex(-1);
    }

    // Upward only when downward is cramped and upward is roomier, as a
    // `<select>` does; the bottom navigation bar counts as the floor, which is
    // the defect `LocationPicker` measured on a phone (ISSUES UI-6).
    React.useLayoutEffect(() => {
      if (!expanded) return;
      const field = wrapperRef.current?.getBoundingClientRect();
      if (!field) return;
      const bar = document.querySelector<HTMLElement>("[data-fixed-bottom]");
      const barTop = bar?.getBoundingClientRect().top;
      const floor =
        barTop !== undefined && barTop > 0 ? barTop : window.innerHeight;
      const below = floor - field.bottom;
      setDropUp(below < MIN_ROOM && field.top > below);
    }, [expanded]);

    function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          if (!expanded) {
            open(false, 0);
          } else {
            setActiveIndex((index) => Math.min(index + 1, shown.length - 1));
          }
          break;
        case "ArrowUp":
          event.preventDefault();
          if (!expanded) {
            open(false, matchingOptions(options, "").length - 1);
          } else {
            setActiveIndex((index) => Math.max(index - 1, 0));
          }
          break;
        case "Enter": {
          const option = expanded ? shown[activeIndex] : undefined;
          if (option !== undefined) {
            event.preventDefault();
            choose(option);
          }
          break;
        }
        case "Escape":
          if (expanded) {
            event.preventDefault();
            setIsOpen(false);
          }
          break;
        default:
          break;
      }
    }

    const activeId =
      expanded && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined;

    return (
      <div className="relative" ref={wrapperRef}>
        <Input
          {...props}
          ref={ref}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listboxId : undefined}
          aria-activedescendant={activeId}
          className={cn("pr-9", className)}
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value);
            open(true);
          }}
          onFocus={(event) => {
            onFocus?.(event);
            open(false);
          }}
          onClick={() => {
            if (!isOpen) open(false);
          }}
          onBlur={(event) => {
            onBlur?.(event);
            setIsOpen(false);
          }}
          onKeyDown={handleKeyDown}
        />
        {/* Drawn, not a control: a tap on it lands on the field beneath. */}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />

        {expanded ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-label={listLabel}
            // Keeps focus in the field through a pointer selection, so the
            // choice does not blur it and close the panel before the click.
            onMouseDown={(event) => event.preventDefault()}
            data-placement={dropUp ? "above" : "below"}
            className={cn(
              "absolute z-20 max-h-64 w-full overflow-auto rounded-md border border-border bg-card shadow-lg",
              dropUp ? "bottom-full mb-1" : "top-full mt-1",
            )}
          >
            {shown.map((option, index) => (
              <li
                key={option}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={foldText(option) === foldText(value)}
                onClick={() => choose(option)}
                // Inset, because the panel scrolls and an outset outline on
                // the first or last row is clipped by the overflow.
                className={cn(
                  "flex min-h-[48px] cursor-pointer items-center px-3 py-2 text-sm text-foreground hover:bg-muted",
                  index === activeIndex &&
                    "outline-2 -outline-offset-2 outline-ring",
                )}
              >
                {option}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  },
);
Combobox.displayName = "Combobox";

export { Combobox };
