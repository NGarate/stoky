/**
 * Teaches TypeScript that the jest-dom matchers registered in
 * `src/__tests__/setup/matchers.ts` are available on Bun's `expect`.
 *
 * Less `toBeEmpty`, which both define with different signatures: jest-dom's
 * is its deprecated element check, Bun's is the one for strings, arrays and
 * objects. TypeScript 7 refuses an interface that inherits both, and
 * `matchers.ts` leaves jest-dom's unregistered so the runtime agrees.
 * `toBeEmptyDOMElement` is the element check.
 */
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

type DomMatchers<E, R> = Omit<TestingLibraryMatchers<E, R>, "toBeEmpty">;

declare module "bun:test" {
  interface Matchers<T = unknown> extends DomMatchers<
    typeof expect.stringContaining,
    T
  > {}

  interface AsymmetricMatchers extends DomMatchers<
    typeof expect.stringContaining,
    unknown
  > {}
}
