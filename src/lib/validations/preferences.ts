import { z } from "zod";

import { SNACKBAR_DURATIONS } from "@/lib/snackbar-duration";

/**
 * The display preferences that belong to an account.
 *
 * Two of the three live here, and which two is the whole design:
 *
 * - **Language** and **how long a confirmation stays** are properties of the
 *   person. Somebody who reads English reads English on the kitchen tablet
 *   too, and somebody who needs longer to read a message needs longer in the
 *   shop as well. Both follow the account.
 * - **Theme** is a property of the screen — a phone that goes dark at night,
 *   a tablet on a bright worktop — so it stays in `localStorage` and is not
 *   in this schema. `src/lib/theme.ts` has said so since it was written.
 *
 * The language is not here either, and for a different reason: it has to be
 * settable on `/login`, where there is no account, so it is written by a
 * server action that records the cookie as well (`src/lib/i18n/cookies.ts`).
 * A procedure that needs a session could not serve the one screen that most
 * needs the switcher.
 *
 * `SNACKBAR_DURATIONS` rather than a retyped list of three strings: the store
 * that reads the value, the control that offers it and this schema have to
 * agree, and three copies of a fact is how one of them stops agreeing.
 */
export const snackbarDurationSchema = z.object({
  snackbarDuration: z.enum(SNACKBAR_DURATIONS),
});

export type SnackbarDurationInput = z.infer<typeof snackbarDurationSchema>;
