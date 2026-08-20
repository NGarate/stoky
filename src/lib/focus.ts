/**
 * Which elements a Tab press will actually visit, inside a container.
 *
 * A focus trap has to know its first and last stop, and the obvious way to
 * find them — one `querySelectorAll` of the focusable selectors — is wrong for
 * one control: **a radio group is a single tab stop.** The browser visits the
 * checked radio and skips the rest, or visits the first when none is checked.
 *
 * A trap that does not model that computes a `last` the browser never reaches,
 * so the wrap never fires and focus escapes the trap entirely. Whether that
 * happens is pure luck about ordering: it depends on whether the last control
 * in the panel happens to be a radio group and whether the *last radio in it*
 * happens to be the selected one. `NavSheet` had this latent for as long as
 * its language `<select>` sat after the theme radios, and it appeared the
 * moment a third preference was added below them.
 *
 * Grouping is by `name` within the same form — which is the DOM's own rule,
 * and the reason `ThemeControl` mints its name with `useId` rather than
 * hardcoding one.
 */

/** Everything that can hold focus, in DOM order. */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function tabbableWithin(container: HTMLElement): HTMLElement[] {
  const focusable = [
    ...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ];

  const radios = focusable.filter(
    (element): element is HTMLInputElement =>
      element instanceof HTMLInputElement && element.type === "radio",
  );

  // The one radio per group the browser will stop on: the checked one, or the
  // first when the group has no selection.
  const stops = new Set<HTMLElement>();
  const seen = new Set<string>();
  for (const radio of radios) {
    const key = radio.name;
    // A radio with no name is its own group, so it is always a stop.
    if (key === "") {
      stops.add(radio);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const group = radios.filter((other) => other.name === key);
    stops.add(group.find((other) => other.checked) ?? group[0]!);
  }

  return focusable.filter(
    (element) =>
      !(element instanceof HTMLInputElement && element.type === "radio") ||
      stops.has(element),
  );
}
