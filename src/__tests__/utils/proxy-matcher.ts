/**
 * Whether the proxy runs on a request, answered by Next's own code from the
 * real `config.matcher` in `src/proxy.ts`.
 *
 * Next's internals, deliberately. `getMiddlewareMatchers` is what the build
 * runs on `config.matcher` to produce the regexp in
 * functions-config-manifest.json, and `getMiddlewareRouteMatcher` is what the
 * server tests each request against. Compiling the source any other way —
 * path-to-regexp by hand, or reading a built manifest, which a clean checkout
 * does not have — would test a copy of the framework's behaviour rather than
 * the behaviour. If a Next upgrade moves either, this file fails, which is
 * the right time to look again. `getMiddlewareMatchers` is exported at run
 * time but missing from the package's declarations, hence the namespace
 * import and the signature written out below.
 */
import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info";
import type { ProxyMatcher } from "next/dist/build/analysis/get-page-static-info";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher";
import type { NextConfig } from "next";
import { config } from "@/proxy";

const { getMiddlewareMatchers } = pageStaticInfo as unknown as {
  getMiddlewareMatchers: (
    matcher: typeof config.matcher,
    nextConfig: NextConfig,
  ) => ProxyMatcher[];
};

const match = getMiddlewareRouteMatcher(
  getMiddlewareMatchers(config.matcher, {} as NextConfig),
);

/**
 * As `resolve-routes.js` asks it: the raw pathname, then the decoded one, and
 * the proxy runs if either matches.
 */
export function proxyRuns(
  pathname: string,
  headers: Record<string, string> = {},
): boolean {
  // `matchHas` reads only `headers` off the request for a header condition.
  const request = { headers } as unknown as Parameters<typeof match>[1];
  return (
    match(pathname, request, {}) ||
    match(decodeURIComponent(pathname), request, {})
  );
}
