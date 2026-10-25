"use client";

import { useEffect } from "react";
import type { JSX } from "react";

/**
 * The last resort: the root layout itself failed.
 *
 * This replaces `app/layout.tsx` rather than rendering inside it, which is the
 * whole reason it exists and also the reason it is written the way it is. It
 * has to supply its own `<html>` and `<body>`, and it is **outside every
 * provider** — no `NextIntlClientProvider`, no theme, no fonts. Calling
 * `useTranslations` here throws inside the boundary that is supposed to be
 * catching things.
 *
 * So the words are hardcoded, in both languages, and that is a decision rather
 * than an oversight. The alternatives were worse: reading `navigator.language`
 * puts a branch in the one component that must not have bugs, and picking
 * Spanish alone leaves an English reader with a page they cannot act on. Two
 * short sentences fit.
 *
 * The styles are inline for the same reason. The stylesheet is loaded by the
 * layout this is standing in for, so a Tailwind class here is a class with no
 * rules behind it — the page would render as unstyled text on white, in dark
 * mode too. `color-scheme` and a `prefers-color-scheme` media query are not
 * available to an inline style attribute, so this deliberately uses colours
 * that are legible either way rather than pretending to theme itself.
 *
 * `(dashboard)/error.tsx` is the one that will actually be seen, and it does
 * speak the reader's language. This is for the case where even that could not
 * be rendered.
 *
 * It takes `retry`, not `reset`, for the reason `(dashboard)/error.tsx` gives:
 * in this Next `reset` re-renders without re-fetching, so a root layout that
 * failed on the server failed again, and "Recargar" did nothing.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}): JSX.Element {
  useEffect(() => {
    console.error("[boundary] the root layout failed to render", error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          background: "#f7f7f8",
          color: "#1a1a1a",
          fontFamily: "system-ui, -apple-system, sans-serif",
          lineHeight: 1.6,
        }}
      >
        <main style={{ maxWidth: "34rem" }}>
          <h1 style={{ fontSize: "1.5rem", margin: "0 0 1rem" }}>
            La aplicación no ha podido arrancar
          </h1>
          <p style={{ margin: "0 0 0.5rem" }}>
            Algo ha fallado antes de que la página pudiera cargarse. Vuelve a
            cargarla; si sigue igual, avisa a quien administra el hogar.
          </p>
          <p style={{ margin: "0 0 1.5rem", color: "#4a4a4a" }}>
            The application could not start. Reload the page; if it keeps
            happening, tell whoever runs the household.
          </p>

          <button
            onClick={() => retry()}
            style={{
              minHeight: "48px",
              padding: "0 1.25rem",
              fontSize: "1rem",
              cursor: "pointer",
              color: "#ffffff",
              background: "#1a1a1a",
              border: "none",
              borderRadius: "0.375rem",
            }}
            type="button"
          >
            Recargar · Reload
          </button>

          {error.digest ? (
            <p
              style={{
                marginTop: "1.5rem",
                fontSize: "0.875rem",
                color: "#4a4a4a",
              }}
            >
              {`Referencia · reference: ${error.digest}`}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
