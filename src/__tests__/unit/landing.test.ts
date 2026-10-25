import { describe, it, expect } from "bun:test";
import {
  CHOOSE_PATH,
  SCREEN_PATHS,
  isLandingScreen,
  landingPath,
} from "@/lib/landing";

/**
 * §5.1's precedence, which is three sentences and one omission.
 *
 * Journey 8's proof is two accounts and two devices: on the house tablet
 * account A chooses kitchen, and account B signing in on the *same* tablet must
 * be asked rather than silently placed in kitchen mode. That property is not
 * visible in this function — it comes from the key the caller reads the choice
 * under — so the tests below cover the decision, and the integration suite
 * covers the key.
 */

describe("a choice already made on this device", () => {
  it("is honoured, whatever it was", () => {
    for (const screen of ["DASHBOARD", "SHOPPING", "KITCHEN"] as const) {
      expect(landingPath({ role: "MEMBER", choice: screen })).toBe(
        SCREEN_PATHS[screen],
      );
    }
  });

  it("beats the role's default, including for a kitchen account", () => {
    // The choice is changeable from settings, and a setting the next visit
    // overrules is not a setting.
    expect(landingPath({ role: "KITCHEN", choice: "SHOPPING" })).toBe(
      "/shopping",
    );
    expect(landingPath({ role: "KITCHEN", choice: "DASHBOARD" })).toBe(
      "/dashboard",
    );
  });
});

describe("a device nobody has been asked about", () => {
  it("sends a kitchen account straight to the kitchen", () => {
    // "The role sets the default: a kitchen account lands on the kitchen
    // screen without being asked."
    expect(landingPath({ role: "KITCHEN", choice: undefined })).toBe(
      "/kitchen",
    );
  });

  it("asks everybody else", () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
      expect(landingPath({ role, choice: undefined })).toBe(CHOOSE_PATH);
    }
  });

  it("asks when the role is not known either", () => {
    // Least surprise rather than least privilege: being asked is recoverable,
    // being silently put somewhere is what §5.1 exists to stop.
    expect(landingPath({ role: undefined, choice: undefined })).toBe(
      CHOOSE_PATH,
    );
  });

  it("does not quietly fall back to the Panel", () => {
    // This is the omission that matters. Landing somewhere reasonable is why
    // the question went unasked through two phases: nobody is inconvenienced
    // by a default, so nobody builds the choice.
    expect(landingPath({ role: "MEMBER", choice: undefined })).not.toBe(
      "/dashboard",
    );
  });
});

describe("what may cross a wire", () => {
  it("accepts the three screens and nothing else", () => {
    for (const screen of ["DASHBOARD", "SHOPPING", "KITCHEN"]) {
      expect(isLandingScreen(screen)).toBe(true);
    }

    for (const hostile of [
      undefined,
      null,
      "",
      "dashboard",
      "PANEL",
      "/kitchen",
      "toString",
      "constructor",
      "__proto__",
      42,
      { screen: "KITCHEN" },
    ]) {
      expect(isLandingScreen(hostile)).toBe(false);
    }
  });

  it("maps every screen to a route, with no gaps", () => {
    // A screen with no path would redirect to `undefined` — a 404 for whoever
    // chose it, on every visit, until somebody noticed.
    for (const path of Object.values(SCREEN_PATHS)) {
      expect(path.startsWith("/")).toBe(true);
    }
    expect(Object.keys(SCREEN_PATHS)).toHaveLength(3);
  });
});
