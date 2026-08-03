/**
 * Teaches TypeScript that the jest-dom matchers registered in
 * `src/__tests__/setup/matchers.ts` are available on Bun's `expect`.
 */
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "bun:test" {
  interface Matchers<T = unknown>
    extends TestingLibraryMatchers<typeof expect.stringContaining, T> {}

  interface AsymmetricMatchers
    extends TestingLibraryMatchers<typeof expect.stringContaining, unknown> {}
}
