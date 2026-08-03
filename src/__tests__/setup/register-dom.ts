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
