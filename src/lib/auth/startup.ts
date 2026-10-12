import { assertKnownRegistrationMode } from "@/lib/auth/registration";
import { assertUsableSecret } from "@/lib/auth/secret";

/**
 * Ends the process if the configuration is one this application refuses: a
 * session signing key anybody could have, or a `STOKY_REGISTRATION` it does
 * not know.
 *
 * Called from `src/instrumentation.ts` as the Node server starts; see there for
 * why it is called at start rather than on first import of `@/lib/auth`.
 *
 * **It exits rather than throws**, and that is measured, not assumed. A throw
 * from `register` is caught by Next 16's standalone server, which logs "Failed
 * to prepare server" and goes on listening, answering 500 to every request,
 * health check included — refused, but not stopped, and a restart policy never
 * fires on a process that is still up. Exiting is what makes the container
 * stop with the reason as the last line of its log.
 *
 * Every check runs before the exit, so an operator with two problems reads
 * both in one log rather than fixing one and restarting into the next.
 *
 * In a module of its own, loaded only under the Node runtime, because
 * `process.exit` does not exist on the Edge and Next warns at build time about
 * any instrumentation code that could reach it there.
 */
export function refuseToStartMisconfigured(): void {
  let refused = false;

  for (const check of [assertUsableSecret, assertKnownRegistrationMode]) {
    try {
      check();
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      refused = true;
    }
  }

  if (refused) process.exit(1);
}
