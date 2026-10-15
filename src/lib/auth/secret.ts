/**
 * Refusing to start with a signing key anybody can read.
 *
 * `NEXTAUTH_SECRET` signs the session cookie and keys the account tags in the
 * security log. `src/lib/auth/instance.ts` hands it to Better Auth as both
 * `secret` and the single entry of `secrets`, because left to itself Better
 * Auth prefers `BETTER_AUTH_SECRETS`, then `BETTER_AUTH_SECRET`, then
 * `AUTH_SECRET` — values this guard never sees. Better Auth only warns about a
 * short key, so before this guard nothing in the application looked at what
 * it was — and `.env.example` ships a placeholder,
 * `your-secret-key-here-change-in-production`, which is **published in this
 * repository**. A deployment that copies the file and does not change that
 * line is signing sessions with a key that is in a public git history: anyone
 * can forge a cookie for any account, and nothing about the running system
 * looks wrong.
 *
 * That is the same shape as the other configuration defects found today — a
 * value two places have to agree about, which nothing checks — except that this
 * one is not an outage. An outage announces itself.
 *
 * **Production only.** Development and the test suites use whatever is to hand,
 * and refusing to start there would trade a real risk nobody faces for a daily
 * obstacle everybody does. With none set there, the instance signs with a
 * random key per process and says so.
 */

/** The placeholder in `.env.example`. Kept in one place so both can be checked. */
export const PLACEHOLDER_SECRET = "your-secret-key-here-change-in-production";

/**
 * Long enough that guessing is not the attack.
 *
 * `openssl rand -base64 32` — which is what `.env.example` tells an operator to
 * run — produces 44 characters. Thirty-two is the floor rather than the target:
 * it refuses a hand-typed word without refusing a key somebody generated a
 * slightly different way.
 */
export const MIN_SECRET_LENGTH = 32;

/**
 * What is wrong with this secret, in words an operator can act on, or null.
 *
 * A message rather than a boolean because the whole point is that the person
 * reading it is looking at a container that will not start, and needs to know
 * which line of which file to change.
 */
export function secretProblem(
  secret: string | undefined,
  nodeEnv: string | undefined,
): string | null {
  if (nodeEnv !== "production") return null;

  if (!secret || secret.trim() === "") {
    return "NEXTAUTH_SECRET is not set. Generate one with `openssl rand -base64 32` and put it in .env.";
  }

  if (secret === PLACEHOLDER_SECRET) {
    return "NEXTAUTH_SECRET is still the example value from .env.example, which is published in this repository — anyone could forge a session. Generate one with `openssl rand -base64 32`.";
  }

  if (secret.length < MIN_SECRET_LENGTH) {
    return `NEXTAUTH_SECRET is ${secret.length} characters; it needs at least ${MIN_SECRET_LENGTH}. Generate one with \`openssl rand -base64 32\`.`;
  }

  return null;
}

/**
 * Throws if the secret is unusable, at import time.
 *
 * Deliberately fatal. A container that will not start is a problem somebody
 * fixes in the first minute; a running instance signing sessions with a public
 * key is a problem nobody finds until it is used.
 */
export function assertUsableSecret(
  secret: string | undefined = process.env.NEXTAUTH_SECRET,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  phase: string | undefined = process.env.NEXT_PHASE,
): void {
  // Not while building. `next build` sets NODE_ENV=production and evaluates
  // every route module to collect page data, so without this the guard fires
  // during the build — including inside `docker build`, where there is no
  // runtime secret and should not be one: the image is environment-independent
  // and receives its secret when the container starts.
  //
  // Found by building. The first version of this file failed `bun run build` on a
  // developer machine and would have broken the production image outright,
  // which is a worse outage than the one it prevents.
  if (phase === "phase-production-build") return;

  const problem = secretProblem(secret, nodeEnv);
  if (problem) throw new Error(`[auth] refusing to start: ${problem}`);
}
