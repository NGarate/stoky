/**
 * Which parent each location is drawn under, so that every location is drawn.
 *
 * Both trees of locations — `location.getTree` on the server and
 * `LocationPicker` in the browser — used to attach a row to its parent whenever
 * the parent was in the list, and treat as a root only a row with no parent.
 * That is correct for a tree and loses rows from anything else:
 *
 * - **an orphan**, whose parent is not in the list, was a root on the server
 *   and simply absent from the picker;
 * - **a cycle**, A inside B inside A, had both parents present, so neither was
 *   ever a root and the whole loop — and everything stored under it — vanished
 *   from both. `location.delete` refuses a location with sub-locations, so a
 *   household could neither see nor remove it. Two concurrent moves made one
 *   (ISSUES.md LOC-1) before `location.update` took a lock; data written then
 *   is still in the database.
 *
 * So the rule is reachability rather than "has a parent": a row whose chain of
 * parents reaches a root keeps its parent, and anything else — an orphan, or a
 * member of a loop — is drawn at the top level. A row merely *below* a loop
 * keeps its parent, which is now a top-level row, so the loop's contents stay
 * where they were. The result is always a forest, which is what lets every
 * recursive walk downstream of it (`flattenTree`, the settings screen's nested
 * lists) assume it terminates.
 *
 * One pass over the rows, each visited once: a walk up from a row stops at the
 * first row already decided, so a household's worth of locations costs a
 * household's worth of steps. Pure, so the browser and the server share it.
 */
export interface LocationLink {
  id: string;
  parentId: string | null;
}

/** Each location's id to the parent it is drawn under; `null` for the top level. */
export function drawnParents(
  locations: ReadonlyArray<LocationLink>,
): Map<string, string | null> {
  const parentOf = new Map<string, string | null>();
  for (const location of locations)
    parentOf.set(location.id, location.parentId);

  const drawn = new Map<string, string | null>();

  for (const start of locations) {
    if (drawn.has(start.id)) continue;

    // Walk up until the chain leaves the list, reaches a row already decided,
    // or comes back to a row on this walk — which is a loop.
    const path: string[] = [];
    const position = new Map<string, number>();
    let current: string | null = start.id;
    while (current !== null && !drawn.has(current) && !position.has(current)) {
      position.set(current, path.length);
      path.push(current);
      const parent: string | null = parentOf.get(current) ?? null;
      current = parent !== null && parentOf.has(parent) ? parent : null;
    }

    // Everything from the row the walk came back to onwards is the loop.
    const loopFrom =
      current !== null && position.has(current)
        ? (position.get(current) as number)
        : path.length;

    path.forEach((id, index) => {
      const parent = parentOf.get(id) ?? null;
      const reachable = parent !== null && parentOf.has(parent);
      drawn.set(id, index < loopFrom && reachable ? parent : null);
    });
  }

  return drawn;
}
