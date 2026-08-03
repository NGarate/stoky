import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Location = {
  id: string;
  name: string;
  parentId: string | null;
  _count?: { stockEntries: number };
};

let queryResult: { data: Location[] | undefined; isLoading: boolean } = {
  data: [],
  isLoading: false,
};

mock.module("@/lib/trpc/client", () => ({
  api: {
    location: {
      list: {
        useQuery: () => queryResult,
      },
    },
  },
}));

const { LocationPicker } = await import(
  "@/components/inventory/LocationPicker"
);

const locations: Location[] = [
  { id: "kitchen", name: "Cocina", parentId: null, _count: { stockEntries: 4 } },
  { id: "fridge", name: "Nevera", parentId: "kitchen" },
  { id: "pantry", name: "Despensa", parentId: null, _count: { stockEntries: 0 } },
];

beforeEach(() => {
  queryResult = { data: locations, isLoading: false };
});

afterEach(cleanup);

describe("LocationPicker", () => {
  it("shows a loading state while locations are fetching", () => {
    queryResult = { data: undefined, isLoading: true };
    render(<LocationPicker onChange={() => {}} />);

    expect(screen.getByText("Cargando ubicaciones...")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the placeholder when nothing is selected", () => {
    render(<LocationPicker onChange={() => {}} />);

    expect(screen.getByText("Seleccionar ubicación")).toBeInTheDocument();
  });

  it("accepts a custom placeholder", () => {
    render(<LocationPicker onChange={() => {}} placeholder="¿Dónde?" />);

    expect(screen.getByText("¿Dónde?")).toBeInTheDocument();
  });

  it("shows the selected location's name", () => {
    render(<LocationPicker value="fridge" onChange={() => {}} />);

    expect(screen.getByText("Nevera")).toBeInTheDocument();
    expect(screen.queryByText("Seleccionar ubicación")).toBeNull();
  });

  it("keeps the dropdown closed until the trigger is clicked", () => {
    render(<LocationPicker onChange={() => {}} />);

    expect(screen.queryByText("Cocina")).toBeNull();
  });

  it("lists only root locations when opened", async () => {
    render(<LocationPicker onChange={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /Seleccionar/ }));

    expect(screen.getByRole("button", { name: /Cocina/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Despensa/ })).toBeInTheDocument();
    // "Nevera" is a child of "Cocina" and is not rendered at the root level.
    expect(screen.queryByRole("button", { name: /Nevera/ })).toBeNull();
  });

  it("appends a non-zero stock count to the location name", async () => {
    render(<LocationPicker onChange={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /Seleccionar/ }));

    expect(screen.getByRole("button", { name: "Cocina (4)" })).toBeInTheDocument();
    // A zero count must not render as "(0)".
    expect(screen.getByRole("button", { name: "Despensa" })).toBeInTheDocument();
  });

  it("emits the chosen location id and closes", async () => {
    const onChange = mock((_id: string | undefined) => {});
    render(<LocationPicker onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: /Seleccionar/ }));
    await userEvent.click(screen.getByRole("button", { name: "Cocina (4)" }));

    expect(onChange).toHaveBeenCalledWith("kitchen");
    expect(screen.queryByRole("button", { name: "Despensa" })).toBeNull();
  });

  it("offers a clear option that emits undefined", async () => {
    const onChange = mock((_id: string | undefined) => {});
    render(<LocationPicker value="kitchen" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: /Cocina/ }));
    await userEvent.click(
      screen.getByRole("button", { name: "Sin ubicación específica" }),
    );

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("hides the clear option when allowRoot is false", async () => {
    render(<LocationPicker onChange={() => {}} allowRoot={false} />);

    await userEvent.click(screen.getByRole("button", { name: /Seleccionar/ }));

    expect(screen.queryByText("Sin ubicación específica")).toBeNull();
  });

  it("closes when the backdrop is clicked", async () => {
    render(<LocationPicker onChange={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /Seleccionar/ }));
    await userEvent.click(screen.getByRole("button", { name: "Close dropdown" }));

    expect(screen.queryByRole("button", { name: "Cocina (4)" })).toBeNull();
  });

  it("renders without crashing when the query returns nothing", () => {
    queryResult = { data: undefined, isLoading: false };
    render(<LocationPicker onChange={() => {}} />);

    expect(screen.getByText("Seleccionar ubicación")).toBeInTheDocument();
  });
});
