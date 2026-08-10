import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
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

const { RouteState, isNoHouseholdError } = await import(
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

describe("RouteState", () => {
  it("shows the skeleton while loading, and no error and no form", () => {
    renderWithIntl(
      <RouteState error={null} isLoading onRetry={() => {}} title="Inventario" />,
    );

    expect(screen.getByRole("heading", { name: "Inventario" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("offers a way to create a household when that is what is missing", () => {
    renderWithIntl(
      <RouteState
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
        error={trpcError("INTERNAL_SERVER_ERROR")}
        isLoading={false}
        onRetry={onRetry}
        title="Productos"
      />,
    );

    expect(screen.queryByLabelText(/hogar/i)).toBeNull();
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
  });

  it("retries the query when asked", async () => {
    const onRetry = mock(() => {});
    renderWithIntl(
      <RouteState
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
        error={trpcError("PRECONDITION_FAILED")}
        isLoading={false}
        onRetry={() => {}}
        title="Inventario"
      />,
    );

    expect(screen.queryByRole("status")).toBeNull();

    createOptions.onError?.();

    expect(await screen.findByText(/no se ha podido crear el hogar/i)).toBeInTheDocument();
  });
});
