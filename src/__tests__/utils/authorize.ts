import { authConfig } from "@/lib/auth";
import { DEVICE_ID_COOKIE } from "@/lib/device";

/**
 * Drives the credentials provider's `authorize` the way Auth.js does.
 *
 * This is the application's only credential-verification path. It used not to
 * be: `auth.login` was a second one, mounted on the public tRPC router,
 * unmetered and unused by the interface, and it was where every credential
 * test pointed. Removing it left the real path with no coverage at all, so the
 * tests were moved here rather than deleted.
 *
 * Each call takes its own address, because `authorize` counts a rate-limit
 * attempt before it looks at anything (ISSUES.md CRITICAL-4) — sharing one
 * address across tests would make the sixth test in a file fail for reasons
 * that have nothing to do with what it asserts.
 */

type AuthorizeResult = Awaited<ReturnType<NonNullable<AuthorizeFn>>>;
type AuthorizeFn = (
  credentials: Record<string, unknown>,
  request: Request,
) => Promise<unknown>;

let addressCounter = 0;

/** A distinct address per call, so one test cannot spend another's budget. */
export function freshTestAddress(): string {
  addressCounter += 1;
  return `198.51.100.${addressCounter % 250}-${process.pid}-${addressCounter}`;
}

/**
 * The configured `authorize`, from `options`.
 *
 * Auth.js normalises a provider and puts a trivial `authorize: () => null` on
 * the resulting object, keeping the configured function in `options`; at
 * runtime it merges `options` over the provider, so the real one runs. Reading
 * `providers[0].authorize` therefore gets the stub, and a test written against
 * it passes or fails for reasons that have nothing to do with the application
 * — which is exactly what happened here before the guard below was added.
 */
function configuredAuthorize(): AuthorizeFn {
  const provider = authConfig.providers[0] as unknown as {
    authorize?: AuthorizeFn;
    options?: { authorize?: AuthorizeFn };
  };
  const fn = provider.options?.authorize ?? provider.authorize;

  if (typeof fn !== "function") {
    throw new Error("The credentials provider exposes no authorize function");
  }
  if (fn.length < 2) {
    // The real one takes (credentials, request); the stub takes none. Without
    // this, an Auth.js upgrade that moves the function silently turns every
    // sign-in test into an assertion about a function that returns null.
    throw new Error(
      "Resolved Auth.js's placeholder authorize rather than the configured one",
    );
  }
  return fn;
}

/**
 * `deviceId` is sent as the `stoky_device` cookie, the way a browser that has
 * been here before sends it; leave it out for a browser that has not.
 */
export async function signInWith(
  credentials: { email: string; password: string },
  options: { address?: string; deviceId?: string } = {},
): Promise<AuthorizeResult> {
  const headers: Record<string, string> = {
    "x-forwarded-for": options.address ?? freshTestAddress(),
  };
  if (options.deviceId) headers.cookie = `${DEVICE_ID_COOKIE}=${options.deviceId}`;
  const request = new Request("http://localhost/api/auth/callback/credentials", {
    headers,
  });

  return (await configuredAuthorize()(credentials, request)) as AuthorizeResult;
}
