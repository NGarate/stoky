import "../setup/matchers";
import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { Section } from "@/components/ui/section";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

afterEach(cleanup);

describe("Section", () => {
  it("is a region named by its own h2", () => {
    render(
      <Section title="Necesita reposición">
        <p>Leche</p>
      </Section>,
    );

    // The region a screen reader lists is called what the reader sees.
    const region = screen.getByRole("region", { name: "Necesita reposición" });
    const heading = screen.getByRole("heading", { level: 2, name: "Necesita reposición" });
    expect(region.contains(heading)).toBe(true);
    expect(region.textContent).toContain("Leche");
  });

  it("has one heading size, in sentence case, never a tracked uppercase label", () => {
    render(<Section title="Para comprar">x</Section>);

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.className).toContain("text-lg");
    expect(heading.className).toContain("text-heading");
    expect(heading.className).not.toContain("uppercase");
    expect(heading.className).not.toContain("tracking");
    expect(heading.className).not.toContain("md:text-2xl");
  });

  it("grows only at the kitchen's distance", () => {
    render(<Section density="touch" title="Usar ya">x</Section>);

    expect(screen.getByRole("heading", { level: 2 }).className).toContain("md:text-2xl");
  });

  it("puts the aside opposite the heading and after it in reading order", () => {
    render(
      <Section aside={<a href="/inventory">Ver todo</a>} title="Caduca pronto">
        x
      </Section>,
    );

    const heading = screen.getByRole("heading", { level: 2 });
    const link = screen.getByRole("link", { name: "Ver todo" });
    expect(
      heading.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("gives two sections two different names", () => {
    render(
      <>
        <Section title="Uno">x</Section>
        <Section title="Dos">y</Section>
      </>,
    );

    const ids = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("the screens' section headings", () => {
  it("are never tracked uppercase labels", () => {
    // "PARA COMPRAR" and "USAR YA" in small tracked grey capitals were
    // labels rather than headings, and the commonest tell of a template.
    const root = join(import.meta.dir, "..", "..", "app");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".tsx")) files.push(path);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(10);

    const shouting = files.filter((path) => {
      const source = readFileSync(path, "utf8");
      return (
        /<h[1-6][^>]*className="[^"]*\buppercase\b/s.test(source) ||
        /<h2[^>]*>\s*<button[^>]*\buppercase\b/s.test(source)
      );
    });
    expect(shouting).toEqual([]);
  });
});
