import { describe, expect, it } from "bun:test";
import { getAuthErrorKey } from "@/lib/auth/error-messages";
import { registerSchema } from "@/lib/validations/auth";
import { REGISTRATION_CLOSED_MESSAGE } from "@/lib/auth/registration";

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

  it("names the identity rule rather than asking to check the details", () => {
    // The message tRPC sends for a refused input is the ZodError's JSON, so
    // the test feeds the real one rather than a string written to match.
    const refused = registerSchema.safeParse({
      email: "noel@example.com",
      name: "Noel",
      password: "noel en la cocina",
    });

    expect(getAuthErrorKey(refused.error?.message, "register")).toBe(
      "passwordContainsIdentity",
    );
  });

  it("says registration is closed rather than asking to check the details", () => {
    // The exact constant `auth.register` refuses with — no detail the person
    // could change would get them in, so "check the details" would be a lie.
    expect(getAuthErrorKey(REGISTRATION_CLOSED_MESSAGE, "register")).toBe(
      "registrationClosed",
    );
  });

  it("still calls any other refused input a generic failure", () => {
    const refused = registerSchema.safeParse({
      email: "ana@example.com",
      name: "Ana",
      password: "short",
    });

    expect(getAuthErrorKey(refused.error?.message, "register")).toBe(
      "registerError",
    );
  });

  it("falls back to the action-specific generic error", () => {
    expect(getAuthErrorKey(undefined, "login")).toBe("loginError");
    expect(getAuthErrorKey("unexpected failure", "register")).toBe(
      "registerError",
    );
  });
});
