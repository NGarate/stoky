import { describe, expect, it } from "bun:test";
import { getAuthErrorKey } from "@/lib/auth/error-messages";

describe("getAuthErrorKey", () => {
  it("maps credentials provider errors to invalid credentials", () => {
    expect(getAuthErrorKey("CredentialsSignin", "login")).toBe(
      "invalidCredentials",
    );
    expect(getAuthErrorKey("Invalid credentials", "login")).toBe(
      "invalidCredentials",
    );
  });

  it("maps duplicate account errors to email exists", () => {
    expect(getAuthErrorKey("Email already registered", "register")).toBe(
      "emailExists",
    );
    expect(
      getAuthErrorKey(
        "Unique constraint failed on the fields: (`email`)",
        "register",
      ),
    ).toBe("emailExists");
  });

  it("falls back to the action-specific generic error", () => {
    expect(getAuthErrorKey(undefined, "login")).toBe("loginError");
    expect(getAuthErrorKey("unexpected failure", "register")).toBe(
      "registerError",
    );
  });
});
