import "../setup/matchers";
import { describe, it, expect, afterEach } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * The matcher that reports instead of hanging.
 *
 * `expect(screen.queryByText("…")).toBeNull()` reads like the obvious way to
 * say something is gone, and it is — right up until it is wrong. Then the
 * received value is a happy-dom element and the runner serialises it to build
 * the failure message, walking a node graph whose children point back at
 * their parents. The cost scales with the subtree and is pathological at
 * every size: an **empty** `<dl>` took ten seconds, and a row of the kitchen
 * screen never returned at all — killed at thirty seconds, and twice at five
 * minutes at 100% of a core. The replacement fails the identical assertion in
 * five milliseconds.
 *
 * `CLAUDE.md` says an exit of 124 means a step is stuck rather than slow. A
 * whole class of component assertion that can only ever wedge — never go red
 * — is a gate that reports infrastructure trouble where it should be
 * reporting a bug. This file is the proof that the replacement does not.
 */

afterEach(cleanup);

function Screen(): React.JSX.Element {
  return (
    <ul>
      <li>Leche entera</li>
    </ul>
  );
}

describe("toBeAbsent", () => {
  it("passes when nothing matched", () => {
    render(<Screen />);

    expect(screen.queryByText("Pan")).toBeAbsent();
  });

  it("fails, in a sentence, when something did", () => {
    render(<Screen />);

    // Run through the failure path on purpose. If this test finishes at all,
    // the matcher did not serialise the node — which is the whole point of
    // it, and cannot be asserted any other way.
    let message = "";
    try {
      expect(screen.queryByText("Leche entera")).toBeAbsent();
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("<li>");
    expect(message).toContain("Leche entera");
  });

  it("says so for undefined as well as null", () => {
    expect(undefined).toBeAbsent();
  });
});
