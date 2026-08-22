import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TRPCClientError } from "@trpc/client";
import { renderWithIntl } from "../utils/render";

/**
 * ISSUES.md HOUSE-1 and UI-8, at the point where they are visible.
 *
 * Every dashboard route rendered `if (isLoading || !result)`, so a failed
 * query kept the loading skeleton on screen for ever — no message, no retry,
 * no way forward. One cause of that failure was structural rather than
 * transient: an account with no household, which no amount of waiting fixes.
 *
 * These are three different screens and the component has to tell them apart
 * from the error alone, which is the part worth pinning.
 */

const createMutate = mock((_input: unknown) => {});
const invalidate = mock(() => Promise.resolve());

let createPending = false;
let createOptions: { onError?: () => void; onSuccess?: () => void } = {};

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ invalidate }),
    household: {
      create: {
        useMutation: (options: typeof createOptions = {}) => {
          createOptions = options;
          return { mutate: createMutate, isPending: createPending };
        },
      },
    },
  },
}));

const { RouteState, isNoHouseholdError, isNotFoundError } = await import(
  "@/components/household/RouteState"
);

/** A refusal shaped the way tRPC delivers one to the browser. */
function trpcError(code: string): TRPCClientError<never> {
  const error = new TRPCClientError<never>("refused");
  Object.defineProperty(error, "data", {
    value: { code, httpStatus: code === "PRECONDITION_FAILED" ? 412 : 500 },
  });
  return error;
}

beforeEach(() => {
  createPending = false;
  createOptions = {};
  createMutate.mockClear();
  invalidate.mockClear();
});

afterEach(cleanup);

describe("isNoHouseholdError", () => {
  it("recognises only PRECONDITION_FAILED", () => {
    expect(isNoHouseholdError(trpcError("PRECONDITION_FAILED"))).toBe(true);
    expect(isNoHouseholdError(trpcError("FORBIDDEN"))).toBe(false);
    expect(isNoHouseholdError(trpcError("INTERNAL_SERVER_ERROR"))).toBe(false);
    expect(isNoHouseholdError(new Error("boom"))).toBe(false);
    expect(isNoHouseholdError(null)).toBe(false);
  });
});

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

  it("still offers the household form when that is the reason, not the signal", () => {
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

    expect(screen.getByText("Todavía no tienes un hogar")).toBeInTheDocument();
    expect(screen.queryByText("Aquí todavía no hay nada guardado")).toBeAbsent();
  });
});

describe("RouteState", () => {
  it("shows the skeleton while loading, and no error and no form", () => {
    renderWithIntl(
      <RouteState
        error={null}
        fetchStatus="fetching"
        isLoading
        onRetry={() => {}}
        title="Inventario"
      />,
    );

    expect(screen.getByRole("heading", { name: "Inventario" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeAbsent();
    expect(screen.queryByRole("textbox")).toBeAbsent();
  });

  it("offers a way to create a household when that is what is missing", () => {
    renderWithIntl(
      <RouteState
        fetchStatus="idle"
        error={trpcError("PRECONDITION_FAILED")}
        isLoading={false}
        onRetry={() => {}}
        title="Inventario"
      />,
    );

    // A named field and a submit, not a dead end.
    expect(screen.getByLabelText(/hogar/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /crear hogar/i })).toBeInTheDocument();
  });

  it("offers a retry, not a household form, for any other failure", () => {
    // The distinction that makes the fix worth anything: a transient failure
    // must not tell someone their household is missing.
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

    expect(screen.queryByLabelText(/hogar/i)).toBeAbsent();
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
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

    await userEvent.click(screen.getByRole("button", { name: /reintentar/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("sends the trimmed name to the server", async () => {
    renderWithIntl(
      <RouteState
        fetchStatus="idle"
        error={trpcError("PRECONDITION_FAILED")}
        isLoading={false}
        onRetry={() => {}}
        title="Inventario"
      />,
    );

    await userEvent.type(screen.getByLabelText(/hogar/i), "  Casa  ");
    await userEvent.click(screen.getByRole("button", { name: /crear hogar/i }));

    expect(createMutate).toHaveBeenCalledWith({ name: "Casa" });
  });

  it("will not submit a name that is only whitespace", async () => {
    renderWithIntl(
      <RouteState
        fetchStatus="idle"
        error={trpcError("PRECONDITION_FAILED")}
        isLoading={false}
        onRetry={() => {}}
        title="Inventario"
      />,
    );

    const submit = screen.getByRole("button", { name: /crear hogar/i });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/hogar/i), "   ");
    expect(submit).toBeDisabled();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("invalidates the whole cache once the household exists", async () => {
    // Not one query: every request this route made was refused for want of a
    // household, so all of them are stale, not just the one that failed last.
    renderWithIntl(
      <RouteState
        fetchStatus="idle"
        error={trpcError("PRECONDITION_FAILED")}
        isLoading={false}
        onRetry={() => {}}
        title="Inventario"
      />,
    );

    await createOptions.onSuccess?.();

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("says so when creating the household fails", async () => {
    renderWithIntl(
      <RouteState
        fetchStatus="idle"
        error={trpcError("PRECONDITION_FAILED")}
        isLoading={false}
        onRetry={() => {}}
        title="Inventario"
      />,
    );

    // The region exists from the start and is empty, rather than appearing
    // when it has something to say: a region created at that moment is one
    // some readers never announce (SyncStatus.tsx:64-65).
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");

    createOptions.onError?.();

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(
        /no se ha podido crear el hogar/i,
      );
    });
  });
});
