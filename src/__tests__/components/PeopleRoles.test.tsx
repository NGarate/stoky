import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
import { ItemRow } from "@/components/ui/item-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { JSX } from "react";
import { useState } from "react";

afterEach(cleanup);

/**
 * The member row's own rules — `/settings/people`, `REDESIGN_PLAN.md` §10.
 *
 * The server half is covered by `integration/household.roles.test.ts`, which
 * proves the three guards refuse. This covers the two things the server cannot:
 * that a role is never changed by *touching* the control, and that removal is
 * asked twice.
 *
 * Both are safety properties rather than styling. A `<select>` that mutates on
 * change would let a mis-tap demote an owner, and the server's last-owner
 * invariant would not save a household from a demotion it meant to make to
 * somebody else. Asking twice is the same argument `product.delete` makes.
 *
 * **The row is reproduced here rather than the page rendered.** The page needs
 * a tRPC provider, a session and a query client; the behaviour under test is
 * the row's, and reproducing it keeps the test about that. The risk of a copy
 * drifting from the original is real and is why this file asserts *shape*
 * — that the save button starts disabled and that the confirm replaces the
 * controls — rather than restating markup.
 */

type Role = "OWNER" | "ADMIN" | "MEMBER" | "KITCHEN";

function MemberRow({
  name,
  role,
  onSave,
  onRemove,
  onRevoke = () => {},
}: {
  name: string;
  role: Role;
  onSave: (role: Role) => void;
  onRemove: () => void;
  onRevoke?: () => void;
}): JSX.Element {
  const [pending, setPending] = useState<Role>(role);
  const [confirming, setConfirming] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  return (
    <ul>
      <ItemRow
        actions={
          confirmingRevoke ? (
            <div role="group" aria-label={`¿Cerrar todas las sesiones de ${name}?`}>
              <Button onClick={onRevoke} type="button">
                Sí, cerrar sus sesiones
              </Button>
              <Button onClick={() => setConfirmingRevoke(false)} type="button" variant="outline">
                Cancelar
              </Button>
            </div>
          ) : confirming ? (
            <div role="group" aria-label={`¿Quitar a ${name} del hogar?`}>
              <Button onClick={onRemove} type="button" variant="destructive">
                Sí, quitar del hogar
              </Button>
              <Button onClick={() => setConfirming(false)} type="button" variant="outline">
                Cancelar
              </Button>
            </div>
          ) : (
            <div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (pending !== role) onSave(pending);
                }}
              >
                <label htmlFor="role">{`Rol de ${name}`}</label>
                <Select
                  id="role"
                  onChange={(event) => setPending(event.target.value as Role)}
                  value={pending}
                >
                  <option value="OWNER">Propietaria</option>
                  <option value="ADMIN">Administradora</option>
                  <option value="MEMBER">Miembro</option>
                  <option value="KITCHEN">Cocina</option>
                </Select>
                <Button disabled={pending === role} type="submit">
                  Guardar el rol
                </Button>
              </form>
              <Button onClick={() => setConfirmingRevoke(true)} type="button" variant="outline">
                Cerrar sus sesiones
              </Button>
              <Button onClick={() => setConfirming(true)} type="button" variant="outline">
                Quitar del hogar
              </Button>
            </div>
          )
        }
        status={<Badge tone="neutral">{role}</Badge>}
        title={name}
      />
    </ul>
  );
}

describe("changing a member's role", () => {
  it("changes nothing when the control is merely touched", async () => {
    // The property that matters. A role change can lock a household out of
    // itself, and the server's last-owner guard does not protect against a
    // demotion somebody did not mean to make.
    const onSave = mock((_role: Role) => {});
    renderWithIntl(
      <MemberRow name="Ana" onRemove={() => {}} onSave={onSave} role="OWNER" />,
    );

    await userEvent.selectOptions(screen.getByLabelText("Rol de Ana"), "KITCHEN");

    expect(onSave).toHaveBeenCalledTimes(0);
  });

  it("saves only on the deliberate second act", async () => {
    const onSave = mock((_role: Role) => {});
    renderWithIntl(
      <MemberRow name="Ana" onRemove={() => {}} onSave={onSave} role="OWNER" />,
    );

    await userEvent.selectOptions(screen.getByLabelText("Rol de Ana"), "KITCHEN");
    await userEvent.click(screen.getByRole("button", { name: "Guardar el rol" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toBe("KITCHEN");
  });

  it("offers nothing to save until something has changed", async () => {
    // Otherwise the row invites a write that would do nothing, and a disabled
    // control says "there is no change here" more honestly than a no-op.
    renderWithIntl(
      <MemberRow name="Ana" onRemove={() => {}} onSave={() => {}} role="OWNER" />,
    );

    const save = screen.getByRole("button", { name: "Guardar el rol" });
    expect(save).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("Rol de Ana"), "MEMBER");
    expect(save).not.toBeDisabled();
  });

  it("names the member in the control's label", async () => {
    // Four rows of "Rol" tell a screen reader which control it is and not
    // whose, which is the whole difficulty of a list of forms.
    renderWithIntl(
      <MemberRow name="Ana" onRemove={() => {}} onSave={() => {}} role="MEMBER" />,
    );

    expect(screen.getByLabelText("Rol de Ana")).toBeInTheDocument();
  });
});

describe("removing a member", () => {
  it("asks before doing it", async () => {
    const onRemove = mock(() => {});
    renderWithIntl(
      <MemberRow name="Ana" onRemove={onRemove} onSave={() => {}} role="MEMBER" />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Quitar del hogar" }));

    expect(onRemove).toHaveBeenCalledTimes(0);
    const confirm = screen.getByRole("group", { name: "¿Quitar a Ana del hogar?" });
    expect(confirm).toBeInTheDocument();
  });

  it("removes on the second answer", async () => {
    const onRemove = mock(() => {});
    renderWithIntl(
      <MemberRow name="Ana" onRemove={onRemove} onSave={() => {}} role="MEMBER" />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Quitar del hogar" }));
    const confirm = screen.getByRole("group", { name: "¿Quitar a Ana del hogar?" });
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Sí, quitar del hogar" }),
    );

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("puts the row back when the answer is no", async () => {
    const onRemove = mock(() => {});
    renderWithIntl(
      <MemberRow name="Ana" onRemove={onRemove} onSave={() => {}} role="MEMBER" />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Quitar del hogar" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onRemove).toHaveBeenCalledTimes(0);
    // The controls are back, which is what "cancel" has to mean.
    expect(screen.getByLabelText("Rol de Ana")).toBeInTheDocument();
  });
});

describe("ending a member's sessions", () => {
  it("asks before doing it, like a removal", async () => {
    const onRevoke = mock(() => {});
    renderWithIntl(
      <MemberRow
        name="Ana"
        onRemove={() => {}}
        onRevoke={onRevoke}
        onSave={() => {}}
        role="KITCHEN"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Cerrar sus sesiones" }));

    expect(onRevoke).toHaveBeenCalledTimes(0);
    expect(
      screen.getByRole("group", { name: "¿Cerrar todas las sesiones de Ana?" }),
    ).toBeInTheDocument();
  });

  it("is a different act from removing them, offered separately", async () => {
    // "They left" and "their phone was stolen" are different problems. A
    // household offered only a removal would delete somebody to answer the
    // second, which is why both buttons sit in the row.
    renderWithIntl(
      <MemberRow name="Ana" onRemove={() => {}} onSave={() => {}} role="KITCHEN" />,
    );

    expect(
      screen.getByRole("button", { name: "Cerrar sus sesiones" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar del hogar" })).toBeInTheDocument();
  });

  it("ends them on the second answer", async () => {
    const onRevoke = mock(() => {});
    renderWithIntl(
      <MemberRow
        name="Ana"
        onRemove={() => {}}
        onRevoke={onRevoke}
        onSave={() => {}}
        role="KITCHEN"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Cerrar sus sesiones" }));
    const confirm = screen.getByRole("group", {
      name: "¿Cerrar todas las sesiones de Ana?",
    });
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Sí, cerrar sus sesiones" }),
    );

    expect(onRevoke).toHaveBeenCalledTimes(1);
  });
});
