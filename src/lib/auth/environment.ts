import { publicUrlProblems } from "@/lib/auth/public-url";

/**
 * The environment variables Better Auth would read behind this application's
 * back, and what is done about each (PROGRESS D135, D136).
 *
 * Better Auth reads some variables of its own, and for a few of them the
 * variable wins over the option it is given. `src/lib/auth/instance.ts`
 * configures every option this application cares about, so what is left is
 * the variables no option can override. Those are **refused**:
 *
 * - **`BETTER_AUTH_TRUSTED_ORIGINS` set.** Better Auth appends it to the
 *   trusted origins whatever the options say
 *   (`context/helpers.mjs`), so an origin nobody reviewed could send a
 *   signed-in browser's POSTs.
 * - **`BETTER_AUTH_TELEMETRY` truthy**, which turns telemetry on whatever
 *   `telemetry.enabled` says. This instance sends nothing anywhere
 *   (`SECURITY.md`, *Outbound*).
 *
 * Beside them, the list of addresses of our own, which Better Auth would
 * otherwise fill in by guessing (`src/lib/auth/public-url.ts`, D138):
 *
 * - **Production without `STOKY_URLS`.** The list decides the trusted origins
 *   and whether the cookie is `Secure`; guessing it from a request is the
 *   downgrade `public-url.ts` describes.
 * - **An entry that is not an http(s) origin**, or **an https first entry
 *   beside plain HTTP to another machine**, where sign-in would loop. These
 *   are refused in production and warned about elsewhere
 *   (`authEnvironmentWarnings`) — except a first entry that is not an http(s)
 *   URL at all, refused everywhere, because Better Auth would throw on it with
 *   a message about itself rather than about the variable.
 *
 * The variables an option already overrides are **ignored, and said to be**:
 * `BETTER_AUTH_SECRET`, `BETTER_AUTH_SECRETS` and `AUTH_SECRET` (the instance
 * names both `secret` and `secrets`), `BETTER_AUTH_URL` (it names `baseURL`),
 * and next-auth's `AUTH_URL`, which next-auth read ahead of `NEXTAUTH_URL` and
 * nothing reads now. An operator who set one of them believes it does
 * something; a line in the start-up log says it does not. `NEXTAUTH_SECRET`
 * and `NEXTAUTH_URL` are not among them: they are the deprecated names of
 * `STOKY_SECRET` and `STOKY_URLS`, still read when those are unset, and
 * warned about by `src/lib/env-names.ts` (D137, D138).
 *
 * Refused twice, deliberately: at start-up, where the process exits with the
 * reason as its last line (`src/lib/auth/startup.ts`), and again when the
 * instance is first built (`getAuth()`), for anything that imports it outside
 * a Next server — where the auth route answers 503.
 *
 * Pure and environment-injected, and free of Better Auth's own modules, so the
 * start-up check loads none of them.
 */

type Env = Record<string, string | undefined>;

/**
 * Whether Better Auth reads this as "on". An empty value is unset: Compose
 * passes `""` for an unset `${X:-}`.
 */
function truthy(value: string | undefined): boolean {
  return !!value && value !== "0" && value.toLowerCase() !== "false";
}

/**
 * Everything about this environment the auth API refuses to be built in, in
 * words an operator can act on, without a prefix: the caller says whether the
 * consequence is a server that will not start or an API that answers 503.
 */
export function authEnvironmentProblems(env: Env = process.env): string[] {
  const problems: string[] = [];

  const production = env.NODE_ENV === "production";
  for (const problem of publicUrlProblems(env)) {
    if (production || problem.everywhere) problems.push(problem.message);
  }
  if (env.BETTER_AUTH_TRUSTED_ORIGINS) {
    problems.push(
      "BETTER_AUTH_TRUSTED_ORIGINS is set. Better Auth would trust those origins whatever this application configures; remove it.",
    );
  }
  if (truthy(env.BETTER_AUTH_TELEMETRY)) {
    problems.push(
      "BETTER_AUTH_TELEMETRY is on. This instance sends nothing anywhere; remove it.",
    );
  }

  return problems;
}

/**
 * Throws the first of `authEnvironmentProblems`, as `[auth] unavailable: …`.
 * Called from `getAuth()`, so the auth route answers 503 and logs
 * `auth.unavailable` instead of serving the wrong policy.
 */
export function assertAuthEnvironment(env: Env = process.env): void {
  const [problem] = authEnvironmentProblems(env);
  if (problem) throw new Error(`[auth] unavailable: ${problem}`);
}

/**
 * Outside production, the problems with `STOKY_URLS` that production refuses,
 * as warnings: a developer's list is often half-edited, and the dev server
 * still works at its first address. Empty in production, where they are
 * refusals instead.
 */
export function authEnvironmentWarnings(env: Env = process.env): string[] {
  if (env.NODE_ENV === "production") return [];
  return publicUrlProblems(env)
    .filter((problem) => !problem.everywhere)
    .map((problem) => `[auth] warning: ${problem.message}`);
}

/** Each variable that is read by nobody, and what is read in its place. */
const IGNORED: ReadonlyArray<readonly [name: string, instead: string]> = [
  ["BETTER_AUTH_SECRET", "STOKY_SECRET"],
  ["BETTER_AUTH_SECRETS", "STOKY_SECRET"],
  ["AUTH_SECRET", "STOKY_SECRET"],
  ["BETTER_AUTH_URL", "STOKY_URLS"],
  ["AUTH_URL", "STOKY_URLS"],
];

/**
 * One warning per variable that is set and ignored, naming the one that is
 * read instead. Never the value: two of them are keys.
 *
 * In every environment, not only production: a developer who set one is as
 * mistaken about what it does as an operator.
 */
export function ignoredAuthVariableWarnings(env: Env = process.env): string[] {
  return IGNORED.filter(([name]) => env[name]?.trim()).map(
    ([name, instead]) =>
      `[auth] warning: ${name} is set and ignored; this application reads ${instead}. Remove it, so nobody believes it is in use.`,
  );
}
