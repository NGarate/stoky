import { authEnvironmentProblems, ignoredAuthVariableWarnings } from "@/lib/auth/environment";
import { publicUrlWarning } from "@/lib/auth/public-url";
import { REGISTRATION_ENV, assertKnownRegistrationMode } from "@/lib/auth/registration";
import { assertUsableSecret, configuredSecret } from "@/lib/auth/secret";
import { renamedVariableWarnings } from "@/lib/env-names";

/**
 * Logs, without stopping anything, a configuration this application tolerates
 * but should not be left in:
 *
 * - a public URL that is plain HTTP to another machine
 *   (`src/lib/auth/public-url.ts`, which says why it is a warning and not a
 *   refusal);
 * - a variable Better Auth or next-auth would have read and this application
 *   ignores — `BETTER_AUTH_SECRET(S)`, `AUTH_SECRET`, `BETTER_AUTH_URL`,
 *   `AUTH_URL` (`src/lib/auth/environment.ts`);
 * - a variable still set under the name it had before the `STOKY_` rename
 *   — `NEXTAUTH_SECRET` alone, or beside `STOKY_SECRET` (`src/lib/env-names.ts`,
 *   D137). In every environment, and only here: this runs once, from
 *   `register()`, so each deprecation is said once per process rather than per
 *   read.
 *
 * Called before `refuseToStartMisconfigured`, so an operator whose instance
 * refuses to start reads this too, in the same log.
 */
export function warnAboutRiskyConfiguration(
  env: Record<string, string | undefined> = process.env,
  warn: (message: string) => void = console.warn,
): void {
  const warning = publicUrlWarning(env);
  if (warning) warn(warning);
  for (const ignored of ignoredAuthVariableWarnings(env)) warn(ignored);
  for (const renamed of renamedVariableWarnings(env)) warn(renamed);
}

/**
 * Ends the process if the configuration is one this application refuses: a
 * session signing key anybody could have, a `STOKY_REGISTRATION` it does not
 * know, or an environment the auth API would refuse to be built in — no
 * `NEXTAUTH_URL` in production, one that is not a URL, or a Better Auth
 * variable that would override its options (`src/lib/auth/environment.ts`).
 *
 * The last used to be found only by the first sign-in, which answered 503
 * while `/api/health` said the instance was healthy (PROGRESS D136). Unlike
 * the secret and the registration mode it is refused in development too,
 * because there the auth API would refuse it just the same: a dev server that
 * stops with the reason is quicker to read than one whose sign-in fails.
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
export function refuseToStartMisconfigured(
  env: Record<string, string | undefined> = process.env,
): void {
  let refused = false;

  const secret = configuredSecret(env);
  for (const check of [
    () => assertUsableSecret(secret.value, env.NODE_ENV, env.NEXT_PHASE, secret.name),
    () => assertKnownRegistrationMode(env[REGISTRATION_ENV], env.NODE_ENV, env.NEXT_PHASE),
  ]) {
    try {
      check();
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      refused = true;
    }
  }

  for (const problem of authEnvironmentProblems(env)) {
    console.error(`[auth] refusing to start: ${problem}`);
    refused = true;
  }

  if (refused) process.exit(1);
}
