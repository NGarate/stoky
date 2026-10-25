import { describe, it, expect } from "bun:test";
import "../setup/matchers";

/**
 * Registering jest-dom's matchers leaves Bun's own in place.
 *
 * Both define `toBeEmpty`. jest-dom's is its deprecated element check and
 * throws on anything that is not a DOM element, so registering it replaced
 * Bun's — and `expect([]).toBeEmpty()` in any component test asked whether an
 * array was an empty element. `setup/matchers.ts` registers every jest-dom
 * matcher but that one; `toBeEmptyDOMElement` is the element check.
 */
describe("the matchers a component test gets", () => {
  it("keeps Bun's toBeEmpty for strings, arrays and objects", () => {
    expect([]).toBeEmpty();
    expect("").toBeEmpty();
    expect({}).toBeEmpty();
    expect([1]).not.toBeEmpty();
  });

  it("has jest-dom's element check under its own name", () => {
    expect(document.createElement("div")).toBeEmptyDOMElement();
  });
});
