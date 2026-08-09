import type { Page } from "@playwright/test";

/**
 * Wait for a page to stop changing, without paying for it when it already has.
 *
 * Every suite here used a flat `waitForTimeout(2500)` after each navigation,
 * because the data-driven routes render their real content only after a tRPC
 * round trip and auditing the skeleton would pass while proving nothing. The
 * cost is that the sleep is paid whether or not it is needed: across the whole
 * matrix that was most of an hour spent doing nothing, which is how a run gets
 * long enough that a healthy one and a hung one look the same from outside.
 *
 * This races the sleep against network quiet. A page whose queries have
 * resolved continues immediately; one still fetching gets the ceiling it had
 * before. It cannot be slower than what it replaces, and it cannot wait less
 * than the page needs unless the page lies about being idle.
 *
 * `networkidle` is discouraged by Playwright's own guidance for good reasons —
 * a page that polls never reaches it — which is exactly why it is a race and
 * not an await. The ceiling is the contract; idle is the optimisation.
 *
 * Idle alone is not enough, and running the suite in parallel is what proved it.
 * There is a quiet window between the document finishing and hydration issuing
 * the first tRPC query, and under load it grows past the half second Playwright
 * calls idle — so `settle` returned on a skeleton, the audits passed on a page
 * with no content in it, and `dynamic-routes` failed outright because a list
 * that had not arrived yet links to nothing. So idle has to be followed by the
 * DOM standing still: data arriving is nodes being inserted, and a page that has
 * gone quiet on both counts has rendered whatever it is going to render.
 *
 * Only `childList` and `characterData` are watched, not attributes. A React
 * re-render that changes a class is not content arriving, and a spinner that
 * toggles one would make "quiet" unreachable on exactly the pages this is for.
 *
 * Deliberately not used for the pause before submitting a form. That one is
 * waiting for hydration, and a submit that beats hydration falls back to a
 * native browser POST — on the login form, a password in the query string.
 * There is no reliable external signal for "React has attached its handlers",
 * so those stay flat sleeps: they are paid once per test rather than once per
 * navigation, and being wrong there costs more than the second it saves.
 */
export async function settle(page: Page, ceiling = 6000): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await Promise.race([quiet(page), page.waitForTimeout(ceiling)]);

  // And then the page's own heading, because "quiet" and "rendered" are not the
  // same claim. `/shopping` returns a bare "Cargando…" while its query is in
  // flight — no heading, no landmark, no controls — and a suite that audits that
  // reports either nothing wrong or, as it did here, "found 0 visible h1" on a
  // page that has one. Bounded and swallowed on purpose: a route that genuinely
  // never renders a heading is a finding, and it belongs to the assertion that
  // was written to make it, not to a helper that waits.
  await page
    .waitForSelector("h1", { state: "visible", timeout: 5_000 })
    .catch(() => {});
}

/**
 * Network idle, confirmed by the DOM not moving straight afterwards.
 *
 * Three attempts rather than one, because the first idle is often the pause
 * before the query goes out: seeing the DOM change during the confirmation
 * window means more is coming, so it goes round again. Three is enough for
 * "hydrate, fetch, render" and is bounded by `settle`'s ceiling regardless.
 */
async function quiet(page: Page): Promise<void> {
  // `load` before anything else, because the window this is closing opens
  // before hydration: a document whose bundles are still downloading is idle by
  // Playwright's measure and motionless by the observer's, and would satisfy
  // both checks while the query that fills the page has not been issued yet.
  await page.waitForLoadState("load").catch(() => {});

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.waitForLoadState("networkidle").catch(() => {});
    if (await stillFor(page, 250)) return;
  }
}

/** Whether the document went `ms` milliseconds without gaining or losing text. */
function stillFor(page: Page, ms: number): Promise<boolean> {
  return page
    .evaluate(
      (window_) =>
        new Promise<boolean>((resolve) => {
          let moved = false;
          const observer = new MutationObserver(() => {
            moved = true;
          });
          observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            characterData: true,
          });
          setTimeout(() => {
            observer.disconnect();
            resolve(!moved);
          }, window_);
        }),
      ms,
    )
    .catch(() => true);
}
