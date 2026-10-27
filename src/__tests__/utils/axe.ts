import axe from "axe-core";

/** WCAG 2.0 and 2.1, every level up to AAA: the bar this project holds. */
const AAA_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag2aaa",
  "wcag21a",
  "wcag21aa",
  "wcag21aaa",
];

/**
 * axe at AAA over a rendered component, as one readable string — empty when
 * clean, so `expect(await axeViolations(container)).toBe("")` fails with the
 * list.
 *
 * happy-dom has no layout, so the rules that measure pixels — contrast above
 * all — come back incomplete rather than violated. Contrast is
 * `scripts/check-contrast.ts`'s job, against the tokens.
 */
export async function axeViolations(root: Element): Promise<string> {
  const { violations } = await axe.run(root, {
    runOnly: { type: "tag", values: AAA_TAGS },
  });
  return violations
    .map(
      (v) =>
        `[${v.impact}] ${v.id} — ${v.help}: ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(" "))
          .join(", ")}`,
    )
    .join("\n");
}
