/**
 * Registers the happy-dom globals as a module side effect.
 *
 * This lives in its own module so that importing it runs `register()` before
 * any sibling import in the preload is evaluated. ES module imports are
 * hoisted, so doing this inline alongside the Testing Library imports would let
 * `@testing-library/dom` bind to a world with no `document`.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

// Recharts and other layout-aware libraries expect ResizeObserver to exist.
// happy-dom does not implement it, so provide an inert stub.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    ResizeObserverStub;
}

/**
 * Keep a failure readable.
 *
 * Testing Library prints the whole DOM when a query finds nothing, and these
 * screens are large enough that the dump buries the assertion that failed.
 * 8 KB is enough to see the element that was searched and its neighbours.
 *
 * Not a fix for the slow failing run found while checking a kitchen test could
 * fail — that one timed out and this did not change it, so the cost is
 * somewhere else (most likely `getAllByRole` computing accessible names across
 * a larger tree). Said plainly rather than implied, because a comment claiming
 * a fix nobody measured is worse than no comment.
 */
process.env.DEBUG_PRINT_LIMIT ??= "8000";
