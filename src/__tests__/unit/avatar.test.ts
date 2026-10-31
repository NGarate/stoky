import { describe, expect, it } from "bun:test";
import { initialsOf } from "@/components/ui/avatar";

describe("initialsOf", () => {
  it("takes the first letter of the first two words", () => {
    expect(initialsOf("Noa García López")).toBe("NG");
    expect(initialsOf("  ana  ")).toBe("A");
  });

  it("does not cut a letter outside the basic plane in half", () => {
    expect(initialsOf("𝒜da Ruiz")).toBe("𝒜R");
  });

  it("falls back to the address when the name is blank", () => {
    expect(initialsOf("   ", "zoe@example.com")).toBe("Z");
    expect(initialsOf("", "")).toBe("");
  });
});
