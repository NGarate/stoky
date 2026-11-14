import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { cleanup } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";

/**
 * The tab's name in the document title, on the page whoever reaches the
 * installation sees first: `/login`, with no session. The owner chose to show
 * it there (plan 2026-11-12, §2). Which name the layout passes, and its
 * defaults, is `installationNames` in `pwa-manifest.test.ts`.
 */
mock.module("next/navigation", () => ({
  usePathname: () => "/login",
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: () => {},
}));

const { RouteTitle } = await import("@/components/ui/route-title");

afterEach(cleanup);

describe("the document title on /login", () => {
  it("ends in the household's tab name", () => {
    renderWithIntl(<RouteTitle name="Casa García" />, { locale: "es" });
    expect(document.title).toBe("Iniciar sesión · Casa García");
  });
});
