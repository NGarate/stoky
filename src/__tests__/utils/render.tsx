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
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ComposerProvider } from "@/components/offline/Composer";
import type { ReactElement, ReactNode } from "react";
import messages from "../../../messages/es.json";

const TIME_ZONE = "Europe/Madrid";

function IntlWrapper({ children }: { children: ReactNode }): ReactElement {
  return (
    <NextIntlClientProvider
      locale="es"
      messages={messages}
      timeZone={TIME_ZONE}
      now={new Date("2026-01-01T00:00:00.000Z")}
    >
      <ComposerProvider composer={TEST_COMPOSER}>{children}</ComposerProvider>
    </NextIntlClientProvider>
  );
}

/** Render a component wrapped in the Spanish next-intl provider. */
export function renderWithIntl(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
): RenderResult {
  return render(ui, { wrapper: IntlWrapper, ...options });
}

export { messages as esMessages };
