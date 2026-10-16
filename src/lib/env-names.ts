/**
 * Environment variables that changed name, and how the old name keeps working
 * for a while (PROGRESS D137).
 *
 * Stoky's own settings take the `STOKY_` prefix because the names they had
 * were not ours: `NEXTAUTH_*` is read by next-auth, `AUTH_*` and
 * `BETTER_AUTH_*` by Better Auth, each on its own initiative and sometimes in
 * preference to what the application configures. A variable an operator sets
 * for this application should be read by this application alone.
 *
 * An installation from before the rename keeps working:
 *
 * - **only the old name is set**: it is read, and a deprecation warning says
 *   to rename it;
 * - **both are set**: the new name wins, and a warning says the old one is
 *   ignored;
 * - **an empty value counts as unset**, because Compose passes `""` for an
 *   unset `${X:-}`, and a blank line in `.env` is not a setting.
 *
 * The warnings are logged once, at start-up
 * (`warnAboutRiskyConfiguration` in `src/lib/auth/startup.ts`, called from
 * `register()`), never per read. They name variables and never print a value:
 * one of them is a key.
 *
 * Pure and environment-injected, with no imports, so the start-up hook, the
 * health check and the account tag can all read through it.
 */

type Env = Record<string, string | undefined>;

/** One variable that changed name. */
export interface RenamedVariable {
  /** The name this application documents and reads first. */
  readonly current: string;
  /** The name an installation from before the rename may still have. */
  readonly legacy: string;
}

/** The session signing key, which also keys the security log's account tags. */
export const SECRET_VARIABLE: RenamedVariable = {
  current: "STOKY_SECRET",
  legacy: "NEXTAUTH_SECRET",
};

/**
 * The addresses the instance is reached at, the first canonical (D138). One
 * URL under its old name; a list under its new one, and the old value is a
 * list of one.
 */
export const URLS_VARIABLE: RenamedVariable = {
  current: "STOKY_URLS",
  legacy: "NEXTAUTH_URL",
};

/** Every rename, for the start-up warnings. */
export const RENAMED: readonly RenamedVariable[] = [SECRET_VARIABLE, URLS_VARIABLE];

/** A value read through a rename, and which name it came from. */
export interface RenamedValue {
  /** The value as written, or undefined when neither name holds one. */
  readonly value: string | undefined;
  /**
   * The variable the value came from — the current name when neither is set,
   * because that is the one an operator should be told to set.
   */
  readonly name: string;
  readonly from: "current" | "legacy" | null;
}

/** Set, in the sense the rename rule means: present and not blank. */
function isSet(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

/** The value of a renamed variable: the current name if set, else the legacy one. */
export function readRenamed(env: Env, pair: RenamedVariable): RenamedValue {
  const current = env[pair.current];
  if (isSet(current)) return { value: current, name: pair.current, from: "current" };
  const legacy = env[pair.legacy];
  if (isSet(legacy)) return { value: legacy, name: pair.legacy, from: "legacy" };
  return { value: undefined, name: pair.current, from: null };
}

/**
 * One warning per rename that is still in use under its old name, or set
 * under both. Never the value.
 */
export function renamedVariableWarnings(env: Env = process.env): string[] {
  const warnings: string[] = [];
  for (const pair of RENAMED) {
    if (!isSet(env[pair.legacy])) continue;
    warnings.push(
      isSet(env[pair.current])
        ? `[config] ${pair.current} and ${pair.legacy} are both set; ${pair.current} is used and ${pair.legacy} is ignored. Remove it.`
        : `[config] ${pair.legacy} is deprecated; rename it to ${pair.current}. It is still read for now.`,
    );
  }
  return warnings;
}
