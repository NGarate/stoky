import { expect } from "bun:test";
import { screen, waitFor } from "@testing-library/react";

/**
 * A snackbar's action button, once a pointer can reach it.
 *
 * Radix renders a toast one commit before its viewport counts it, and until
 * that effect runs the viewport's region carries `pointer-events: none`
 * (`@radix-ui/react-toast` `hasToasts`). `findByRole` resolves on that first
 * commit, and a `userEvent.click` that lands before the effect is refused:
 * CI failed on it twice (`ProductDetailsForm`, "undoing a save"), and locally
 * every find of the button saw the region still closed to the pointer.
 */
export async function findSnackbarAction(
  name = "Deshacer",
): Promise<HTMLElement> {
  const action = await screen.findByRole("button", { name });
  await waitFor(() => {
    const region = action.closest<HTMLElement>('[role="region"]');
    expect(region?.style.pointerEvents).not.toBe("none");
  });
  return action;
}
