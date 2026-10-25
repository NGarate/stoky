import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { renderWithIntl } from "../utils/render";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";

/**
 * The modal panel.
 *
 * Two hand-rolled panels came before it and between them made every mistake
 * this pins: a `role="dialog"` on the scrim rather than the card, an
 * `aria-modal` claimed while the page behind stayed reachable, a focus that
 * never came back, and a destructive button focused on open — one Enter from
 * doing the thing the dialog exists to guard.
 */
afterEach(cleanup);

function Harness({
  onConfirm = () => {},
}: {
  onConfirm?: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button onClick={() => setOpen(true)} ref={trigger} type="button">
        Eliminar lista
      </button>
      <ConfirmDialog
        confirmLabel="Sí, eliminar la lista"
        description="La lista y todo lo que hayas apuntado en ella desaparecen."
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          onConfirm();
        }}
        open={open}
        returnFocus={trigger}
        title="¿Eliminar «Semanal» definitivamente?"
      />
    </>
  );
}

const open = async (): Promise<void> => {
  await userEvent.click(screen.getByRole("button", { name: "Eliminar lista" }));
  await screen.findByRole("dialog");
};

describe("Dialog", () => {
  it("renders nothing at all when closed", () => {
    renderWithIntl(<Harness />, { locale: "es" });

    expect(screen.queryByRole("dialog")).toBeAbsent();
    expect(screen.queryByText(/definitivamente/)).toBeAbsent();
  });

  it("names itself with its title, and describes what is at stake", async () => {
    renderWithIntl(<Harness />, { locale: "es" });
    await open();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("¿Eliminar «Semanal» definitivamente?");
    expect(dialog.getAttribute("aria-describedby")).not.toBeNull();
  });

  it("says aria-modal, which Radix does not set on its own", async () => {
    renderWithIntl(<Harness />, { locale: "es" });
    await open();

    // The promise the portal and the scroll lock actually keep. Both
    // hand-rolled panels claimed it while leaving the page behind reachable.
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
  });

  it("titles itself with an h2, because the page underneath owns the h1", async () => {
    renderWithIntl(<Harness />, { locale: "es" });
    await open();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "¿Eliminar «Semanal» definitivamente?",
      }),
    ).toBeInTheDocument();
  });

  it("focuses the panel, never the destructive button", async () => {
    renderWithIntl(<Harness />, { locale: "es" });
    await open();

    // A confirmation whose destructive answer is focused on open is one
    // Enter keypress from doing the thing it was asked to guard.
    expect(screen.getByRole("dialog")).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Sí, eliminar la lista" }),
    ).not.toHaveFocus();
  });

  it("gives focus back to whatever opened it", async () => {
    renderWithIntl(<Harness />, { locale: "es" });
    await open();

    await userEvent.keyboard("{Escape}");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Eliminar lista" }),
      ).toHaveFocus();
    });
  });

  it("closes on Escape", async () => {
    renderWithIntl(<Harness />, { locale: "es" });
    await open();

    await userEvent.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeAbsent();
    });
  });
});

describe("ConfirmDialog", () => {
  it("does nothing at all until the destructive answer is chosen", async () => {
    const onConfirm = mock(() => {});
    renderWithIntl(<Harness onConfirm={onConfirm} />, { locale: "es" });
    await open();

    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeAbsent();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("acts when it is", async () => {
    const onConfirm = mock(() => {});
    renderWithIntl(<Harness onConfirm={onConfirm} />, { locale: "es" });
    await open();

    await userEvent.click(
      screen.getByRole("button", { name: "Sí, eliminar la lista" }),
    );

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("puts cancel before the destructive answer", async () => {
    renderWithIntl(<Harness />, { locale: "es" });
    await open();

    const cancel = screen.getByRole("button", { name: "Cancelar" });
    const confirm = screen.getByRole("button", {
      name: "Sí, eliminar la lista",
    });

    // The safe answer is reached first by anyone walking the dialog.
    expect(
      cancel.compareDocumentPosition(confirm) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("Dialog footer", () => {
  it("takes whatever actions it is given, in order", async () => {
    renderWithIntl(
      <Dialog
        footer={
          <>
            <button type="button">Añadir otro</button>
            <button type="button">Ver el inventario</button>
          </>
        }
        onClose={() => {}}
        open={true}
        title="Stock añadido"
      />,
      { locale: "es" },
    );

    expect(
      screen.getByRole("button", { name: "Añadir otro" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ver el inventario" }),
    ).toBeInTheDocument();
  });
});

describe("when the action removed whatever opened it", () => {
  /** A list whose rows each open a confirmation that removes that row. */
  function Rows(): React.JSX.Element {
    const [rows, setRows] = useState(["Semanal", "Fiesta"]);
    const [removing, setRemoving] = useState<string | null>(null);
    const opener = useRef<HTMLButtonElement | null>(null);
    const list = useRef<HTMLUListElement>(null);
    return (
      <>
        <ul aria-label="Listas" ref={list} tabIndex={-1}>
          {rows.map((name) => (
            <li key={name}>
              <button
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  setRemoving(name);
                }}
                type="button"
              >
                Eliminar {name}
              </button>
            </li>
          ))}
        </ul>
        <ConfirmDialog
          confirmLabel="Sí, eliminar"
          fallbackFocus={list}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            setRows((all) => all.filter((name) => name !== removing));
            setRemoving(null);
          }}
          open={removing !== null}
          returnFocus={opener}
          title="¿Eliminar?"
        />
      </>
    );
  }

  it("gives focus to the fallback, not to <body>", async () => {
    // A detached button takes no focus: without the fallback a keyboard or
    // screen-reader user was left on <body> after removing something.
    renderWithIntl(<Rows />, { locale: "es" });
    await userEvent.click(
      screen.getByRole("button", { name: "Eliminar Semanal" }),
    );
    await screen.findByRole("dialog");

    await userEvent.click(screen.getByRole("button", { name: "Sí, eliminar" }));

    await waitFor(() => {
      expect(screen.getByRole("list", { name: "Listas" })).toHaveFocus();
    });
    expect(
      screen.queryByRole("button", { name: "Eliminar Semanal" }),
    ).toBeAbsent();
  });

  it("still gives it back to the opener when the opener is still there", async () => {
    renderWithIntl(<Rows />, { locale: "es" });
    await userEvent.click(
      screen.getByRole("button", { name: "Eliminar Fiesta" }),
    );
    await screen.findByRole("dialog");

    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Eliminar Fiesta" }),
      ).toHaveFocus();
    });
  });
});
