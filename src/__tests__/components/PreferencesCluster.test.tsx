import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";

/**
 * The cluster is what `/login`, `/register` and `/settings` all render, so it
 * may only hold preferences that can honestly be offered with no account.
 *
 * Theme qualifies: it is a property of the screen and never leaves the device.
 * Language qualifies for a subtler reason — it writes to the account when
 * there is one and to the device either way, which is what lets the same
 * control serve the login page, where a reader who cannot read the interface
 * most needs it.
 *
 * How long a confirmation stays does not qualify, and that is why it left.
 * It is stored against the account (WCAG 2.2.1 is about the person, not the
 * browser), and on `/login` there is no account to store it against — so it
 * would have been a control that appears to save and does not. `/settings`
 * renders it beside this cluster instead.
 */
// The language switcher is a server action away from `next/headers`, which
// has no meaning outside a request.
mock.module("@/lib/i18n/cookies", () => ({
  setLocalePreference: async () => {},
}));

// Complete, per D50: `mock.module` is process-global, so a partial mock here
// deletes exports for every file that runs after it — which is how `usePathname`
// once went missing in CI and nowhere else.
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: () => {},
}));

const { PreferencesCluster } =
  await import("@/components/ui/PreferencesCluster");

afterEach(cleanup);

describe("PreferencesCluster", () => {
  it("offers the theme, which belongs to this screen", () => {
    renderWithIntl(<PreferencesCluster />);

    expect(screen.getByRole("group", { name: "Tema" })).toBeInTheDocument();
  });

  it("offers the language, which works with or without an account", () => {
    renderWithIntl(<PreferencesCluster />);

    expect(screen.getByLabelText("Idioma")).toBeInTheDocument();
  });

  it("lines the two controls up by their labels, not their bottoms", () => {
    const { container } = renderWithIntl(<PreferencesCluster />);

    // `items-end` aligned the controls' bottom edges, and since "Tema" heads
    // a radio group and "Idioma" a select of a different height, the second
    // label sat about 10px lower than the first.
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain("items-start");
    expect(row.className).not.toContain("items-end");
  });

  it("offers no setting that needs an account to store", () => {
    renderWithIntl(<PreferencesCluster />);

    expect(
      screen.queryByRole("group", { name: "Duración de los avisos" }),
    ).toBeAbsent();
  });
});
