import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TRPCClientError } from "@trpc/client";
import { renderWithIntl } from "../utils/render";

/**
 * ISSUES.md UI-8, at the point where it is visible.
 *
 * Every dashboard route rendered `if (isLoading || !result)`, so a failed
 * query kept the loading skeleton on screen for ever — no message, no retry,
 * no way forward.
 *
 * These are three different screens and the component has to tell them apart
 * from the error alone, which is the part worth pinning.
 */

mock.module("next/navigation", () => ({
  usePathname: () => "/shopping/list-1",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  redirect: () => {},
}));

const { RouteState, isNotFoundError } =
  await import("@/components/household/RouteState");

/** A refusal shaped the way tRPC delivers one to the browser. */
function trpcError(code: string): TRPCClientError<never> {
  const error = new TRPCClientError<never>("refused");
  Object.defineProperty(error, "data", {
    value: { code, httpStatus: code === "PRECONDITION_FAILED" ? 412 : 500 },
  });
  return error;
}

afterEach(cleanup);

describe("isNotFoundError", () => {
  it("recognises only NOT_FOUND", () => {
    expect(isNotFoundError(trpcError("NOT_FOUND"))).toBe(true);
    expect(isNotFoundError(trpcError("PRECONDITION_FAILED"))).toBe(false);
    expect(isNotFoundError(new Error("nope"))).toBe(false);
    expect(isNotFoundError(null)).toBe(false);
  });
});

describe("RouteState with no signal", () => {
  it("says nothing is saved rather than showing a skeleton for ever", () => {
    // A paused query is *also* `isPending`, so without an explicit branch the
    // skeleton wins and someone with no signal watches it indefinitely.
    renderWithIntl(
      <RouteState
        error={null}
        fetchStatus="paused"
        isLoading
        onRetry={() => {}}
        title="Inventario"
      />,
    );

    expect(
      screen.getByText("Aquí todavía no hay nada guardado"),
    ).toBeInTheDocument();
    expect(document.querySelector("[aria-busy]")).toBeAbsent();
  });

  it("does not call it a failure, because nothing was attempted", () => {
    renderWithIntl(
      <RouteState
        error={null}
        fetchStatus="paused"
        isLoading
        onRetry={() => {}}
        title="Inventario"
      />,
    );

    expect(
      screen.queryByText("No se han podido cargar los datos"),
    ).toBeAbsent();
  });

  it("offers a way to ask again once there is signal", async () => {
    const onRetry = mock(() => {});
    renderWithIntl(
      <RouteState
        error={null}
        fetchStatus="paused"
        isLoading
        onRetry={onRetry}
        title="Inventario"
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Volver a intentarlo" }),
    );

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("calls an idle query's refusal a failure, not a lack of signal", () => {
    // Paused wins over everything else, but an idle query carrying a refusal
    // must not be swallowed by it.
    renderWithIntl(
      <RouteState
        error={trpcError("PRECONDITION_FAILED")}
        fetchStatus="idle"
        isLoading={false}
        onRetry={() => {}}
        title="Inventario"
      />,
    );

    expect(
      screen.getByText("No se han podido cargar los datos"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Aquí todavía no hay nada guardado"),
    ).toBeAbsent();
  });
});

describe("RouteState", () => {
  it("shows the skeleton while loading, and no error", () => {
    renderWithIntl(
      <RouteState
        error={null}
        fetchStatus="fetching"
        isLoading
        onRetry={() => {}}
        title="Inventario"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Inventario" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeAbsent();
  });

  it("treats an account with no household as any other failure", () => {
    // There used to be a form here to create one. An installation holds one
    // household now, so the refusal is a failure to load like any other,
    // with the same retry, and nothing that offers to make a second
    // household (ISSUES.md HOUSE-1).
    renderWithIntl(
      <RouteState
        actions={<button type="button">Nuevo producto</button>}
        fetchStatus="idle"
        error={trpcError("PRECONDITION_FAILED")}
        isLoading={false}
        onRetry={() => {}}
        title="Inventario"
      />,
    );

    expect(
      screen.getByText("No se han podido cargar los datos"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeAbsent();
    expect(
      screen.getByRole("button", { name: "Nuevo producto" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Volver a intentarlo" }),
    ).toBeInTheDocument();
  });

  it("retries the query when asked", async () => {
    const onRetry = mock(() => {});
    renderWithIntl(
      <RouteState
        fetchStatus="idle"
        error={trpcError("INTERNAL_SERVER_ERROR")}
        isLoading={false}
        onRetry={onRetry}
        title="Productos"
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Volver a intentarlo" }),
    );

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("what a screen reader is told", () => {
  it("keeps one region across every state, so a failure is announced", () => {
    const { rerender, container } = renderWithIntl(
      <RouteState
        error={null}
        fetchStatus="fetching"
        isLoading
        onRetry={() => {}}
        title="Inventario"
      />,
      { locale: "es" },
    );

    const region = container.querySelector('[role="status"]');
    expect(region).not.toBeAbsent();

    rerender(
      <RouteState
        error={new Error("boom")}
        fetchStatus="idle"
        isLoading={false}
        onRetry={() => {}}
        title="Inventario"
      />,
    );

    // The same node, not a new one. A region created at the moment it gains
    // text is the case screen readers may skip — and before this the three
    // states were three separate returns, none of them live at all, so a
    // query that failed replaced the skeleton in silence.
    expect(container.querySelector('[role="status"]')).toBe(region);
    expect(region?.textContent).toContain("No se han podido cargar");
  });

  it("says it is loading, rather than showing five silent grey bars", () => {
    renderWithIntl(
      <RouteState
        error={null}
        fetchStatus="fetching"
        isLoading
        onRetry={() => {}}
        title="Inventario"
      />,
      { locale: "es" },
    );

    // `aria-busy` on a container that is not a live region is not announced.
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
  });

  it("is polite, never a second assertive region", () => {
    const { container } = renderWithIntl(
      <RouteState
        error={new Error("boom")}
        fetchStatus="idle"
        isLoading={false}
        onRetry={() => {}}
        title="Inventario"
      />,
      { locale: "es" },
    );

    // `SyncStatus` owns the one assertive region in this shell; a second
    // makes `getByRole("alert")` ambiguous in every browser test.
    expect(container.querySelector('[role="alert"]')).toBeAbsent();
    expect(
      container.querySelector('[role="status"]')?.getAttribute("aria-live"),
    ).toBe("polite");
  });
});

describe("the page around the state", () => {
  const back = "/shopping/lists";

  it("keeps the way back and the primary action on screen while loading", () => {
    // Loading used to draw a bare title and nothing else, so the screen's
    // way out and its primary action appeared only once the data did — and
    // never, for a query that did not answer.
    renderWithIntl(
      <RouteState
        actions={<button type="button">Nuevo producto</button>}
        back={back}
        error={null}
        fetchStatus="fetching"
        isLoading
        onRetry={() => {}}
        title="Productos"
      />,
    );

    expect(
      screen.getByRole("link", { name: "Volver a tus listas" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Nuevo producto" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("takes the width of the screen it stands in for", () => {
    const { container } = renderWithIntl(
      <RouteState
        error={null}
        fetchStatus="fetching"
        isLoading
        onRetry={() => {}}
        title="Ajustar"
        width="form"
      />,
    );

    expect(container.firstElementChild?.className).toContain("max-w-2xl");
  });

  it("says a thing is gone, why it may be, and the way back — not a retry", () => {
    renderWithIntl(
      <RouteState
        actions={<button type="button">Borrar lista</button>}
        back={back}
        error={trpcError("NOT_FOUND")}
        fetchStatus="idle"
        isLoading={false}
        notFound={{
          title: "Esta lista ya no existe",
          body: "Puede que alguien de tu hogar la haya eliminado.",
        }}
        onRetry={() => {}}
        title="Lista"
      />,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Esta lista ya no existe",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Puede que alguien de tu hogar la haya eliminado."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Volver a tus listas" }),
    ).toBeInTheDocument();
    // Retrying a thing that does not exist fails the same way every time,
    // and an action on it has nothing left to act on.
    expect(screen.queryByRole("button")).toBeAbsent();
  });

  it("still offers a retry for NOT_FOUND when the route has not said what it means", () => {
    renderWithIntl(
      <RouteState
        error={trpcError("NOT_FOUND")}
        fetchStatus="idle"
        isLoading={false}
        onRetry={() => {}}
        title="Lista"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Volver a intentarlo" }),
    ).toBeInTheDocument();
  });

  it("explains a failure in plain words, not the system's", () => {
    renderWithIntl(
      <RouteState
        error={trpcError("INTERNAL_SERVER_ERROR")}
        fetchStatus="idle"
        isLoading={false}
        onRetry={() => {}}
        title="Lista"
      />,
    );

    // "La consulta al servidor ha fallado" is the system describing itself;
    // the person needs what probably happened and what to do (§7 rule 2).
    expect(screen.queryByText(/consulta|servidor/)).toBeAbsent();
    expect(screen.getByText(/conexión/)).toBeInTheDocument();
  });
});
