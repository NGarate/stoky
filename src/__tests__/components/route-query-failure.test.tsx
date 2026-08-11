import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import { renderWithIntl } from "../utils/render";

/**
 * ISSUES.md UI-9, on the two routes that still had it.
 *
 * `/inventory` and `/products` were fixed with UI-8; `/shopping` and
 * `/settings/locations` kept testing `if (isLoading)` alone, so a failed query
 * fell straight through to the empty state. The result is a lie with a
 * plausible shape: someone with four lists is told they have none, and the
 * only tell is that creating one appears to do nothing.
 *
 * The assertion that matters is the *pair* — the failure copy is present AND
 * the empty-state copy is absent. Checking only the first would still pass if
 * a route rendered both, which is a different and equally wrong screen.
 *
 * This is the rendered tier because the question is which branch the component
 * takes, which is a fact about the DOM. Nothing here is geometric.
 */

interface QueryStub {
  data: unknown;
  isPending: boolean;
  error: unknown;
  refetch: () => void;
}

/** What both routes' queries return. Set per test before rendering. */
let queryStub: QueryStub;

const noop = (): void => {};
const idleMutation = { mutate: noop, isPending: false };

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ invalidate: () => Promise.resolve() }),
    household: { create: { useMutation: () => idleMutation } },
    shopping: {
      list: { useQuery: () => queryStub },
      // The preview sits above the list and asks its own question. It is not
      // what is under test, so it stays quiet.
      getAutoList: { useQuery: () => ({ data: undefined, isLoading: false }) },
      create: { useMutation: () => idleMutation },
      generateFromLowStock: { useMutation: () => idleMutation },
    },
    location: { getTree: { useQuery: () => queryStub } },
  },
}));

const { default: ShoppingListsPage } = await import(
  "@/app/(dashboard)/shopping/page"
);
const { default: LocationsPage } = await import(
  "@/app/(dashboard)/settings/locations/page"
);

/** A refusal shaped the way tRPC delivers one to the browser. */
function trpcError(code: string, httpStatus: number): TRPCClientError<never> {
  const error = new TRPCClientError<never>("refused");
  Object.defineProperty(error, "data", { value: { code, httpStatus } });
  return error;
}

const ROUTES = [
  {
    name: "/shopping",
    Page: ShoppingListsPage,
    /** The lie this route told: "No hay listas de compra". */
    emptyState: /No hay listas de compra/,
  },
  {
    name: "/settings/locations",
    Page: LocationsPage,
    /** The lie this route told: "No hay ubicaciones configuradas." */
    emptyState: /No hay ubicaciones configuradas/,
  },
] as const;

beforeEach(() => {
  queryStub = { data: undefined, isPending: false, error: null, refetch: noop };
});

afterEach(cleanup);

describe("a route whose query failed", () => {
  for (const { name, Page, emptyState } of ROUTES) {
    it(`${name} offers a retry instead of claiming the household is empty`, () => {
      queryStub = {
        data: undefined,
        isPending: false,
        error: trpcError("INTERNAL_SERVER_ERROR", 500),
        refetch: noop,
      };

      renderWithIntl(<Page />);

      expect(
        screen.getByText("No se han podido cargar los datos"),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
      expect(screen.queryByText(emptyState)).toBeNull();
    });

    it(`${name} offers a household form when that is what is missing`, () => {
      queryStub = {
        data: undefined,
        isPending: false,
        error: trpcError("PRECONDITION_FAILED", 412),
        refetch: noop,
      };

      renderWithIntl(<Page />);

      expect(
        screen.getByText("Todavía no tienes un hogar"),
      ).toBeInTheDocument();
      expect(screen.queryByText(emptyState)).toBeNull();
    });

    it(`${name} still shows its empty state when the query succeeded with nothing`, () => {
      queryStub = { data: [], isPending: false, error: null, refetch: noop };

      renderWithIntl(<Page />);

      expect(screen.getByText(emptyState)).toBeInTheDocument();
      expect(
        screen.queryByText("No se han podido cargar los datos"),
      ).toBeNull();
    });
  }
});
