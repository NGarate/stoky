import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { screen, cleanup, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
import { SessionKeepAlive } from "@/components/session/SessionKeepAlive";

/**
 * WCAG 2.1 2.2.6 Timeouts, at the point where it is visible.
 *
 * The criterion has two halves and they are easy to conflate: an active
 * session must not die under someone, and an idle one must say so before it
 * takes their work. A component that warns while you are typing satisfies
 * neither.
 */

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

/**
 * A stand-in for `readSessionExpiry`, injected through the prop rather than
 * by mocking `@/lib/auth/client`: a module mock is process-global (D50), and
 * the auth pages' suite replaces that module's sign-in call.
 */
function readerReturning(expires: string) {
  return mock(async () => ({ expires }));
}

afterEach(cleanup);

describe("SessionKeepAlive", () => {
  it("shows nothing while the session has time left", () => {
    renderWithIntl(<SessionKeepAlive expiresAt={inMinutes(15)} readExpiry={readerReturning(inMinutes(15))} />);

    // Silence is the requirement, not an omission: a timeout warning that is
    // always on screen is one nobody reads when it matters.
    expect(screen.queryByRole("alert")).toBeAbsent();
  });

  it("warns, out loud, once the session is nearly over", () => {
    renderWithIntl(<SessionKeepAlive expiresAt={inMinutes(1)} readExpiry={readerReturning(inMinutes(15))} />);

    const alert = screen.getByRole("alert");
    // role="alert" is what makes this reach someone who is not looking at it.
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toMatch(/1 min/);
  });

  it("names the inactivity and the consequence, which is what 2.2.6 asks", () => {
    renderWithIntl(<SessionKeepAlive expiresAt={inMinutes(2)} readExpiry={readerReturning(inMinutes(15))} />);

    const text = screen.getByRole("alert").textContent ?? "";
    expect(text).toMatch(/inactividad/i);
    // "You will be signed out" is not the warning; "you will lose what you have
    // not saved" is.
    expect(text).toMatch(/perder/i);
  });

  it("says so plainly once the session has already gone", () => {
    renderWithIntl(<SessionKeepAlive expiresAt={inMinutes(-1)} readExpiry={readerReturning(inMinutes(15))} />);

    expect(screen.getByRole("alert").textContent).toMatch(/se ha cerrado/i);
  });

  it("offers a way to stay, and taking it clears the warning", async () => {
    const readExpiry = readerReturning(inMinutes(15));
    renderWithIntl(<SessionKeepAlive expiresAt={inMinutes(1)} readExpiry={readExpiry} />);

    // A bare click, not userEvent's: its pointerdown is activity, which
    // refreshes on its own, so the button's call was swallowed as a duplicate
    // while that one was in flight. The count of one held only because the old
    // fetch fake took two awaits to answer; with one, both calls landed, and
    // neither version proved the button itself reached the server.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /seguir conectado/i }));
    });

    expect(readExpiry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeAbsent();
  });

  it("keeps the session alive on activity, without saying anything", async () => {
    const readExpiry = readerReturning(inMinutes(15));
    renderWithIntl(<SessionKeepAlive expiresAt={inMinutes(10)} readExpiry={readExpiry} />);

    await act(async () => {
      window.dispatchEvent(new Event("keydown"));
      await Promise.resolve();
    });

    expect(readExpiry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeAbsent();
  });

  it("does not ask the server again on every keystroke", async () => {
    const readExpiry = readerReturning(inMinutes(15));
    renderWithIntl(<SessionKeepAlive expiresAt={inMinutes(10)} readExpiry={readExpiry} />);

    await act(async () => {
      for (let i = 0; i < 20; i++) window.dispatchEvent(new Event("keydown"));
      await Promise.resolve();
    });

    // Throttled: twenty keystrokes are one person typing, not twenty reasons
    // to re-issue a token.
    expect(readExpiry).toHaveBeenCalledTimes(1);
  });

  it("leaves the warning up when the refresh fails", async () => {
    const failing = mock(async (): Promise<{ expires: string } | null> => {
      throw new Error("offline");
    });
    renderWithIntl(<SessionKeepAlive expiresAt={inMinutes(1)} readExpiry={failing} />);

    await userEvent.click(screen.getByRole("button", { name: /seguir conectado/i }));

    // The session still expires when it was always going to. Hiding the
    // warning because the request failed would be the one outcome that loses
    // work silently.
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("does not steal focus when it appears", () => {
    renderWithIntl(<SessionKeepAlive expiresAt={inMinutes(1)} readExpiry={readerReturning(inMinutes(15))} />);

    // It appears precisely when someone is away from the keyboard. Moving the
    // caret for them is how they come back to a form they were half through
    // and find their cursor somewhere else.
    expect(document.activeElement).toBe(document.body);
  });
});
