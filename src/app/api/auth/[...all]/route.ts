import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth/instance";
import { handleAuthRequest, type AuthHandlerOptions } from "@/server/http/auth-handler";

/**
 * Wiring only. What the auth API does with a request — which endpoints it
 * answers, the limits, the guards on what it returns — is in
 * `src/server/http/auth-handler.ts`, where it can be tested without Next.
 *
 * `getAuth()` is called per request, not here: building the instance at
 * import would run during `next build`, which has no secret and no database.
 */
const options: AuthHandlerOptions = {
  handler: () => toNextJsHandler(getAuth()).POST,
};

export function GET(request: Request): Promise<Response> {
  return handleAuthRequest(request, options);
}

export function POST(request: Request): Promise<Response> {
  return handleAuthRequest(request, options);
}
