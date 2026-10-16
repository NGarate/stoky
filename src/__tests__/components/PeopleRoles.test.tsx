import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
import { ItemRow } from "@/components/ui/item-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { TRPCClientError } from "@trpc/client";
import { addRefusalOf } from "@/components/household/add-member-refusal";
import {
  ResetMemberPasswordDialog,
  resetRefusalOf,
} from "@/components/household/ResetMemberPasswordDialog";
import {
  MemberSessionsDialog,
  memberSessionsRefusalOf,
  type MemberSession,
} from "@/components/household/MemberSessionsDialog";
import { MIN_PASSWORD_LENGTH } from "@/lib/validations/password";
import { addMemberSchema } from "@/lib/validations/household";
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
}: {
  name: string;
  role: Role;
  onSave: (role: Role) => void;
  onRemove: () => void;
}): JSX.Element {
  const [pending, setPending] = useState<Role>(role);
  const [confirming, setConfirming] = useState(false);

  return (
    <ul>
      <ItemRow
        actions={
          confirming ? (
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

describe("creating an account", () => {
  /** A refusal as the client receives it: the code is what the form reads. */
  function refused(code: string, message = "refused"): TRPCClientError<never> {
    const error = new TRPCClientError<never>(message);
    Object.defineProperty(error, "data", { value: { code } });
    return error;
  }

  it("tells an admin who has run out of the hourly meter to wait, not to retry", () => {
    // The per-admin meter refuses for up to an hour; "Inténtalo otra vez"
    // would send the admin straight back into the same refusal.
    expect(addRefusalOf(refused("TOO_MANY_REQUESTS", "Too many accounts created"))).toBe(
      "tooMany",
    );
  });

  it("tells an admin who chose a common password to choose another, not to retry", () => {
    // Built from the procedure's own schema, as tRPC carries a ZodError's
    // message, so rewording the refusal cannot leave this passing against words
    // the server no longer sends.
    const refusal = addMemberSchema.safeParse({
      name: "Ana",
      email: "ana@example.com",
      password: "password1234",
      role: "MEMBER",
    });
    expect(refusal.success).toBe(false);
    expect(addRefusalOf(refused("BAD_REQUEST", refusal.error?.message))).toBe("tooEasy");
  });

  it("reads each other refusal the procedure can give", () => {
    expect(addRefusalOf(refused("CONFLICT"))).toBe("taken");
    expect(
      addRefusalOf(
        refused("BAD_REQUEST", "That password contains the person's own name or email address"),
      ),
    ).toBe("identity");
    expect(addRefusalOf(refused("INTERNAL_SERVER_ERROR"))).toBe("other");
    // Another field's BAD_REQUEST is not the password's fault.
    expect(addRefusalOf(refused("BAD_REQUEST", "Invalid email address"))).toBe("other");
    expect(addRefusalOf(new Error("offline"))).toBe("other");
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

/**
 * A member's sessions — `household.memberSessions` and
 * `household.endMemberSessions`, ASVS 5.0.0 7.4.5, D145. The real dialog: it
 * takes the list and the server calls as props, so it needs no tRPC provider.
 * Which row offers it, and what the page sends, are `EndSession.test.tsx`'s
 * (the tRPC mock lives there, D50); the guards are
 * `integration/session.revocation.test.ts`'s.
 */
describe("a member's sessions", () => {
  const ANA = { id: "member-ana", name: "Ana" };
  const SESSIONS: MemberSession[] = [
    {
      id: "s-tablet",
      device: { browser: "Firefox", os: "Android" },
      screen: "KITCHEN",
      signedInAt: new Date("2026-10-10T08:00:00.000Z"),
      lastUsedAt: new Date("2026-10-15T08:30:00.000Z"),
      remembered: true,
    },
    {
      id: "s-phone",
      device: { browser: null, os: null },
      screen: null,
      signedInAt: new Date("2026-10-15T07:00:00.000Z"),
      lastUsedAt: new Date("2026-10-15T07:10:00.000Z"),
      remembered: false,
    },
  ];

  function refusal(code: string): TRPCClientError<never> {
    const error = new TRPCClientError<never>("refused");
    Object.defineProperty(error, "data", { value: { code } });
    return error;
  }

  function Harness({
    sessions = SESSIONS,
    loadError = null,
    onEndOne = async () => {},
    onEndAll = async () => {},
  }: {
    sessions?: MemberSession[] | undefined;
    loadError?: unknown;
    onEndOne?: (session: { id: string; name: string }) => Promise<unknown>;
    onEndAll?: () => Promise<unknown>;
  }): JSX.Element {
    const [member, setMember] = useState<{ id: string; name: string } | null>(ANA);
    return (
      <MemberSessionsDialog
        loadError={loadError}
        member={member}
        onClose={() => setMember(null)}
        onEndAll={onEndAll}
        onEndOne={onEndOne}
        sessions={sessions}
      />
    );
  }

  it("names the person, and says they stay in the household", () => {
    renderWithIntl(<Harness />, { locale: "es" });

    const dialog = screen.getByRole("dialog", { name: "Sesiones de Ana" });
    expect(dialog).toHaveAccessibleDescription(/sigue perteneciendo al hogar/i);
  });

  it("lists each session as a row named by its device, with an action that says which", () => {
    renderWithIntl(<Harness />, { locale: "es" });

    const rows = within(screen.getByRole("dialog")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Pantalla de cocina")).toBeInTheDocument();
    // The browser too, when the title is the screen.
    expect(within(rows[0]!).getByText("Firefox en Android")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Recordada")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Dispositivo desconocido")).toBeInTheDocument();
    expect(
      within(rows[1]!).getByRole("button", { name: "Cerrar esta: Dispositivo desconocido" }),
    ).toBeInTheDocument();
  });

  it("ends the row pressed, by its id, and nothing else", async () => {
    const onEndOne = mock(async (_session: { id: string; name: string }) => {});
    const onEndAll = mock(async () => {});
    renderWithIntl(<Harness onEndAll={onEndAll} onEndOne={onEndOne} />, { locale: "es" });

    await userEvent.click(screen.getByRole("button", { name: "Cerrar esta: Pantalla de cocina" }));

    expect(onEndOne).toHaveBeenCalledTimes(1);
    expect(onEndOne.mock.calls[0]?.[0]).toEqual({ id: "s-tablet", name: "Pantalla de cocina" });
    expect(onEndAll).toHaveBeenCalledTimes(0);
  });

  it("says an owner's are an owner's to end, and keeps the rows", async () => {
    renderWithIntl(
      <Harness onEndAll={() => Promise.reject(refusal("FORBIDDEN"))} />,
      { locale: "es" },
    );

    await userEvent.click(screen.getByRole("button", { name: "Cerrar todas sus sesiones" }));

    expect(
      await screen.findByText("Solo una persona propietaria puede cerrar las sesiones de otra."),
    ).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getAllByRole("listitem")).toHaveLength(2);
  });

  it("says an owner's are an owner's even to list, and shows no rows", () => {
    renderWithIntl(<Harness loadError={refusal("FORBIDDEN")} sessions={undefined} />, {
      locale: "es",
    });

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("Solo una persona propietaria puede cerrar las sesiones de otra."),
    ).toBeInTheDocument();
    expect(within(dialog).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("says when somebody is signed in nowhere, and offers nothing to end", () => {
    renderWithIntl(<Harness sessions={[]} />, { locale: "es" });

    expect(screen.getByText("Ana no tiene ninguna sesión abierta.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar todas sus sesiones" })).toBeDisabled();
  });

  it("reads each refusal the procedures can give", () => {
    expect(memberSessionsRefusalOf(refusal("FORBIDDEN"))).toBe("notOwner");
    // Ended already, from elsewhere or by its clock: the list was out of date.
    expect(memberSessionsRefusalOf(refusal("NOT_FOUND"))).toBe("gone");
    expect(memberSessionsRefusalOf(refusal("INTERNAL_SERVER_ERROR"))).toBe("failed");
    expect(memberSessionsRefusalOf(new Error("offline"))).toBe("failed");
  });
});

/**
 * Setting a member's password — `household.resetMemberPassword`, security
 * review 2026-10-12. The real dialog rather than a reproduction: it takes the
 * server call as a prop, so it needs no tRPC provider, and what is under test
 * is exactly what ships. The procedure's own guards are
 * `integration/household.members.test.ts`'s.
 */
describe("setting a member's password", () => {
  const ANA = { id: "member-ana", name: "Ana" };

  /** A refusal as the client receives it: the code is what the dialog reads. */
  function refusal(code: string, message = "refused"): TRPCClientError<never> {
    const error = new TRPCClientError<never>(message);
    Object.defineProperty(error, "data", { value: { code } });
    return error;
  }

  function Harness({
    onSubmit,
    initial = ANA,
  }: {
    onSubmit: (password: string) => Promise<unknown>;
    initial?: { id: string; name: string } | null;
  }): JSX.Element {
    const [member, setMember] = useState(initial);
    return (
      <ResetMemberPasswordDialog
        member={member}
        onClose={() => setMember(null)}
        onSubmit={onSubmit}
      />
    );
  }

  const field = () => screen.getByLabelText("Contraseña nueva");
  const submit = () => screen.getByRole("button", { name: "Cambiar la contraseña" });

  it("names the person, and says every session they have will end", () => {
    // The title is the dialog's accessible name: a field for a password is
    // one somebody can fill in for the wrong person.
    renderWithIntl(<Harness onSubmit={async () => {}} />, { locale: "es" });

    const dialog = screen.getByRole("dialog", { name: "Nueva contraseña para Ana" });
    expect(dialog).toHaveAccessibleDescription(/se cerrarán todas sus sesiones/i);
  });

  it("renders nothing while nobody is chosen", () => {
    renderWithIntl(<Harness initial={null} onSubmit={async () => {}} />, {
      locale: "es",
    });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("attaches the rule to the field, with the server's minimum", () => {
    // WCAG 3.3.5: the help is announced with the field, not found by looking.
    renderWithIntl(<Harness onSubmit={async () => {}} />, { locale: "es" });

    expect(field()).toHaveAccessibleDescription(
      new RegExp(`Al menos ${MIN_PASSWORD_LENGTH} caracteres`),
    );
  });

  it("refuses a short password without asking the server, and says why", async () => {
    const onSubmit = mock(async (_password: string) => {});
    renderWithIntl(<Harness onSubmit={onSubmit} />, { locale: "es" });

    await userEvent.type(field(), "corta");
    await userEvent.click(submit());

    expect(onSubmit).toHaveBeenCalledTimes(0);
    expect(
      screen.getByText(`La contraseña necesita al menos ${MIN_PASSWORD_LENGTH} caracteres.`),
    ).toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-invalid", "true");
  });

  it("sends the password from the footer's button, which sits outside the form", async () => {
    // The button is this form's submit only through its `form` attribute.
    const onSubmit = mock(async (_password: string) => {});
    renderWithIntl(<Harness onSubmit={onSubmit} />, { locale: "es" });

    await userEvent.type(field(), "tarro de garbanzos azul");
    await userEvent.click(submit());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toBe("tarro de garbanzos azul");
  });

  it("keeps the dialog open on a refusal and says what to do", async () => {
    // An admin acting on an owner: the answer is to ask an owner, and the
    // field is still there to try somebody else's password.
    renderWithIntl(
      <Harness onSubmit={() => Promise.reject(refusal("FORBIDDEN"))} />,
      { locale: "es" },
    );

    await userEvent.type(field(), "tarro de garbanzos azul");
    await userEvent.click(submit());

    expect(
      await screen.findByText(
        "Solo otra persona propietaria puede cambiar esta contraseña.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("clears a refusal when it is closed, so the next person's dialog starts clean", async () => {
    function Reopening(): JSX.Element {
      const [member, setMember] = useState<{ id: string; name: string } | null>(ANA);
      return (
        <>
          <Button
            onClick={() => setMember({ id: "member-luis", name: "Luis" })}
            type="button"
          >
            Luis
          </Button>
          <ResetMemberPasswordDialog
            member={member}
            onClose={() => setMember(null)}
            onSubmit={() => Promise.reject(refusal("INTERNAL_SERVER_ERROR"))}
          />
        </>
      );
    }
    renderWithIntl(<Reopening />, { locale: "es" });

    await userEvent.type(field(), "tarro de garbanzos azul");
    await userEvent.click(submit());
    expect(
      await screen.findByText("No se ha podido cambiar la contraseña. Inténtalo otra vez."),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Luis" }));

    expect(screen.getByRole("dialog", { name: "Nueva contraseña para Luis" })).toBeInTheDocument();
    expect(
      screen.queryByText("No se ha podido cambiar la contraseña. Inténtalo otra vez."),
    ).toBeNull();
  });

  it("reads each refusal the procedure can give", () => {
    expect(resetRefusalOf(refusal("TOO_MANY_REQUESTS"))).toBe("tooMany");
    expect(resetRefusalOf(refusal("FORBIDDEN"))).toBe("notOwner");
    expect(
      resetRefusalOf(
        refusal("BAD_REQUEST", "That password contains the person's own name or email address"),
      ),
    ).toBe("identity");
    expect(resetRefusalOf(refusal("BAD_REQUEST", "That password is too easy to guess"))).toBe(
      "tooEasy",
    );
    // Gone from the household, or changed while the hash ran: try again.
    expect(resetRefusalOf(refusal("NOT_FOUND"))).toBe("failed");
    expect(resetRefusalOf(refusal("CONFLICT"))).toBe("failed");
    expect(resetRefusalOf(new Error("offline"))).toBe("failed");
  });
});
