/**
 * Who may create an account by themselves: `STOKY_REGISTRATION`.
 *
 * `auth.register` is one of the two procedures anybody who can reach the
 * instance may call, and until this setting existed nothing let an operator
 * close it. Every self-registered stranger got the whole authenticated
 * surface — receipt upload and OCR, an upload volume nothing cleans, every
 * unmetered procedure — and tenant isolation became the only thing between
 * them and the owner's household (security review, 2026-10-12). The
 * installation guide told operators to restrict access at the proxy, which the
 * bundle had no supported way to do.
 *
 * A household does not need open registration: an admin already adds people
 * through **Configuración → Personas del hogar** (`household.addMember`). So:
 *
 * - `open` — anybody may register, as before.
 * - `first-user` — registration is open until the first account exists, then
 *   closed. The person who installs the instance claims it; everybody after
 *   that is added by them.
 * - `closed` — nobody may register.
 *
 * **Unset, it is `first-user` in production and `open` everywhere else.**
 * Production is where strangers can reach it; development and the suites
 * register dozens of accounts and would otherwise need the variable set by
 * every runner. The release bundle passes `first-user` explicitly as well
 * (`deploy/docker-compose.yml`), so the default there is written down twice
 * on purpose: a hand-edited Compose file that drops the line still gets it.
 *
 * **Parsed strictly.** An unknown value — a typo, `Open`, `false` — is
 * `closed` at run time, never a fallback to `open`, and in production the
 * server refuses to start over it (`src/lib/auth/startup.ts`), the same way it
 * refuses an unusable signing key. A typo in a security setting must not mean
 * the least safe value. Empty is treated as unset, which is what Compose's
 * `${STOKY_REGISTRATION:-first-user}` does too.
 *
 * Client-safe: nothing here imports a server module, because the register
 * screen reaches it through `getAuthErrorKey` (`error-messages.ts`).
 */

export const REGISTRATION_MODES = ["open", "first-user", "closed"] as const;

export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

/** The variable, named once so the guard's message and the docs agree. */
export const REGISTRATION_ENV = "STOKY_REGISTRATION";

/**
 * What `auth.register` refuses with when this setting says no.
 *
 * English, because it is what a non-browser client (the iOS app, `curl`)
 * reads; the screens match it through `isRegistrationClosedRefusal` and show
 * their own Spanish-first sentence. One constant on both sides, so the server
 * cannot reword it out from under them.
 */
export const REGISTRATION_CLOSED_MESSAGE =
  "Registration is closed on this instance. Ask a household admin to add you";

/**
 * The PostgreSQL advisory lock `auth.register` holds while it counts accounts
 * and creates one. Arbitrary but fixed: every registration must take the same
 * one, and nothing else in the application takes advisory locks. Exported so
 * the integration suite can hold it and prove a registration waits.
 */
export const REGISTRATION_LOCK_KEY = 7_340_000_001n;

/** Whether a refusal's message is this setting's. */
export function isRegistrationClosedRefusal(message: string | undefined): boolean {
  return Boolean(message?.includes(REGISTRATION_CLOSED_MESSAGE));
}

function isRegistrationMode(value: string): value is RegistrationMode {
  return (REGISTRATION_MODES as readonly string[]).includes(value);
}

export interface RegistrationSetting {
  mode: RegistrationMode;
  /** Why the value was not accepted, in words an operator can act on, or null. */
  problem: string | null;
}

/** The setting, from the raw variable and `NODE_ENV`. Pure, for the tests. */
export function parseRegistrationMode(
  raw: string | undefined,
  nodeEnv: string | undefined,
): RegistrationSetting {
  if (raw === undefined || raw === "") {
    return { mode: nodeEnv === "production" ? "first-user" : "open", problem: null };
  }

  if (isRegistrationMode(raw)) return { mode: raw, problem: null };

  return {
    mode: "closed",
    problem: `${REGISTRATION_ENV} is ${JSON.stringify(raw)}; it must be one of ${REGISTRATION_MODES.join(", ")}. Set it in .env, or remove the line to use first-user.`,
  };
}

/** The mode in force for this process. Read on every call, never cached. */
export function registrationMode(
  env: Record<string, string | undefined> = process.env,
): RegistrationMode {
  return parseRegistrationMode(env[REGISTRATION_ENV], env.NODE_ENV).mode;
}

/**
 * Whether one more account may register, given how many exist.
 *
 * The only place the rule is written. `auth.register` asks it twice — once
 * before any work, and again inside the transaction that creates the account,
 * under a lock, so two people claiming a fresh instance at once cannot both
 * see zero.
 */
export function registrationAllows(mode: RegistrationMode, userCount: number): boolean {
  switch (mode) {
    case "open":
      return true;
    case "first-user":
      return userCount === 0;
    case "closed":
      return false;
  }
}

/**
 * Throws if the setting is not one this application knows, in production.
 *
 * Outside production an unknown value already means `closed`, which is safe
 * and visible the first time someone tries to register; refusing to start
 * there would trade nothing for an obstacle. Not while building, for the same
 * reason as `assertUsableSecret`: `next build` runs with NODE_ENV=production
 * and no runtime configuration.
 */
export function assertKnownRegistrationMode(
  raw: string | undefined = process.env[REGISTRATION_ENV],
  nodeEnv: string | undefined = process.env.NODE_ENV,
  phase: string | undefined = process.env.NEXT_PHASE,
): void {
  if (phase === "phase-production-build") return;
  if (nodeEnv !== "production") return;

  const { problem } = parseRegistrationMode(raw, nodeEnv);
  if (problem) throw new Error(`[auth] refusing to start: ${problem}`);
}
