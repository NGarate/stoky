/**
 * Rendering helpers for component tests.
 *
 * Components are rendered against the real `messages/es.json` catalogue rather
 * than a stubbed translator, so a missing or renamed translation key fails the
 * test instead of silently rendering a placeholder.
 *
 * The composer is here for the same reason. In production every screen that
 * writes sits under `(dashboard)/layout.tsx`'s `ComposerProvider`, and a write
 * outside one is a bug the provider throws on. Matching that here keeps the
 * test environment the same shape as the real one rather than a laxer version
 * of it.
 */

/** A stable account, so a test can assert what an envelope carried. */
export const TEST_COMPOSER = {
  userId: "clttttttttttttttttttttttt",
  householdId: "clhhhhhhhhhhhhhhhhhhhhhhh",
};
import {
  render,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ComposerProvider } from "@/components/offline/Composer";
import type { ReactElement, ReactNode } from "react";
import esMessages from "../../../messages/es.json";
import enMessages from "../../../messages/en.json";

/**
 * Both catalogues, because one of them is where the bugs are.
 *
 * Rendering only in Spanish cannot see a string hardcoded in Spanish — it
 * looks correct — and that is exactly how ISSUES.md I18N-8 survived on the
 * two most-visited pages in the application: a Spanish promotional block sat
 * beside English content and nothing was in a position to notice.
 */
const CATALOGUES = { es: esMessages, en: enMessages } as const;

export type TestLocale = keyof typeof CATALOGUES;

const TIME_ZONE = "Europe/Madrid";

function wrapperFor(locale: TestLocale) {
  return function IntlWrapper({
    children,
  }: {
    children: ReactNode;
  }): ReactElement {
    return (
      <NextIntlClientProvider
        locale={locale}
        messages={CATALOGUES[locale]}
        timeZone={TIME_ZONE}
        now={new Date("2026-01-01T00:00:00.000Z")}
      >
        <ComposerProvider composer={TEST_COMPOSER}>{children}</ComposerProvider>
      </NextIntlClientProvider>
    );
  };
}

/** Render a component wrapped in the next-intl provider. Spanish by default. */
export function renderWithIntl(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper"> & { locale?: TestLocale },
): RenderResult {
  const { locale = "es", ...rest } = options ?? {};
  return render(ui, { wrapper: wrapperFor(locale), ...rest });
}

export { esMessages, enMessages };
