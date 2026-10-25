import { TRPCClientError } from "@trpc/client";
import {
  isPasswordIdentityRefusal,
  isPasswordTooEasyRefusal,
} from "@/lib/validations/password";

/** Every reason creating an account can be refused, each with its own sentence. */
export type AddMemberRefusal =
  "taken" | "identity" | "tooEasy" | "tooMany" | "other";

/**
 * `household.addMember`'s refusal, in words the admin can act on.
 *
 * Each named case is one where "try again" is wrong, because trying again
 * fails the same way:
 * - `CONFLICT` is the database's own unique constraint, translated. Checking
 *   first and then inserting would race with itself.
 * - The identity rule's `BAD_REQUEST`: the browser cannot see that rule coming,
 *   and the same password would be refused again.
 * - The policy's "too easy to guess" `BAD_REQUEST` (a password from the top of
 *   every leak): the same password is refused again. Matched on its message,
 *   not on the code, because this input has other fields a `BAD_REQUEST` could
 *   be about.
 * - `TOO_MANY_REQUESTS` is the per-admin meter (`addMemberRateLimit`), which
 *   refuses for up to an hour; the admin is told to wait, not to retry.
 *
 * A pure function rather than the page's inline `onError`, so the mapping can
 * be tested without rendering a page that needs a session and a tRPC client.
 */
export function addRefusalOf(error: unknown): AddMemberRefusal {
  const code =
    error instanceof TRPCClientError
      ? (error.data?.code as string | undefined)
      : undefined;
  const message = error instanceof Error ? error.message : undefined;

  if (code === "CONFLICT") return "taken";
  if (code === "TOO_MANY_REQUESTS") return "tooMany";
  if (isPasswordIdentityRefusal(message)) return "identity";
  if (isPasswordTooEasyRefusal(message)) return "tooEasy";
  return "other";
}
