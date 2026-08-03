/**
 * Rendering helpers for component tests.
 *
 * Components are rendered against the real `messages/es.json` catalogue rather
 * than a stubbed translator, so a missing or renamed translation key fails the
 * test instead of silently rendering a placeholder.
 */
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
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
      {children}
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
