/**
 * Registers the jest-dom assertions (toBeDisabled, toHaveClass, toBeVisible,
 * ...) on Bun's `expect`.
 *
 * Imported by each component test rather than by the preload: importing
 * `@testing-library/*` from inside the preload evaluates it too early, and its
 * `screen` helper permanently binds to a world without a `document.body`.
 */
import { expect } from "bun:test";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers as Parameters<typeof expect.extend>[0]);
