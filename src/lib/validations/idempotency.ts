import { z } from "zod";
import { MAX_ID_LENGTH } from "./bounds";

/**
 * The envelope every mutation a device can compose offline carries.
 *
 * It travels in the Zod input rather than in a header. The configured link is
 * `unstable_httpBatchStreamLink`, so one HTTP request carries several unrelated
 * calls — a header addresses the request, and the request is a bag. There is no
 * header that can name *this* call's key.
 *
 * `composedByUserId` is a **mis-attribution guard, not authentication**. It is
 * client-supplied, so it may only ever cause a refusal, never grant anything:
 * the server compares it with the session and rejects a mismatch. What it
 * defends against is our own bug — a queue left behind on a shared tablet and
 * drained under the next person's session — not against an attacker, who can
 * simply send the right value.
 */
export const replayable = z.object({
  /**
   * A UUID minted on the device when the change was made. `.uuid()` is a real
   * bound, not decoration: it caps the length of a string that becomes half a
   * primary key, so a caller cannot use the key column as storage.
   */
  idempotencyKey: z.string().uuid(),
  /**
   * The account the change was composed under. Compared, never trusted.
   * `.cuid()` alone does not bound it — Zod 4's pattern is `c` and six or
   * more lowercase letters and digits, with no maximum — so the length is
   * stated as well.
   */
  composedByUserId: z.string().max(MAX_ID_LENGTH).cuid(),
});

export type Replayable = z.infer<typeof replayable>;
