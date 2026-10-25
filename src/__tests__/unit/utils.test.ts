import { describe, it, expect } from "bun:test";
import { cn } from "@/lib/utils";

describe("Utility Functions", () => {
  describe("cn (className merger)", () => {
    it("should merge simple class names", () => {
      const result = cn("class1", "class2", "class3");
      expect(result).toBe("class1 class2 class3");
    });

    it("should handle conditional classes", () => {
      const isActive = true;
      const isDisabled = false;

      const result = cn(
        "base-class",
        isActive && "active",
        isDisabled && "disabled",
      );
      expect(result).toBe("base-class active");
    });

    it("should merge Tailwind classes correctly", () => {
      const result = cn("px-2 py-1", "px-4");
      expect(result).toBe("py-1 px-4");
    });

    it("should filter out falsy values", () => {
      const result = cn("class1", null, undefined, false, "", "class2");
      expect(result).toBe("class1 class2");
    });

    it("should handle nested arrays", () => {
      const result = cn(["class1", "class2"], "class3");
      expect(result).toBe("class1 class2 class3");
    });

    it("should handle complex Tailwind merging", () => {
      const result = cn(
        "text-sm font-medium text-gray-500",
        "text-lg text-blue-600",
      );
      expect(result).toContain("font-medium");
      expect(result).toContain("text-lg");
      expect(result).toContain("text-blue-600");
    });

    it("should return empty string for no arguments", () => {
      const result = cn();
      expect(result).toBe("");
    });

    it("should handle object syntax", () => {
      const result = cn({
        class1: true,
        class2: false,
        class3: true,
      });
      expect(result).toBe("class1 class3");
    });
  });
});
