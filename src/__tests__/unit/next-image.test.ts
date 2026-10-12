import { describe, it, expect } from "bun:test";
import nextConfig from "../../../next.config";

/**
 * The Image Optimization endpoint is switched off, and `next.config.ts`
 * depends on that.
 *
 * The config excludes `sharp` from the standalone output — 19 MB of native
 * library — on the grounds that `/_next/image` cannot be reached. Until
 * 2026-10-12 this file guarded that premise by checking that nothing imports
 * `next/image`, and the premise was false: Next 16 serves `/_next/image`
 * whatever the source imports, and with the defaults it fetched any
 * same-origin path for an anonymous caller, through the whole router, and
 * returned whatever sniffed as a raster image. Without `sharp` it did not fail
 * either; Next serves the original bytes (SECURITY_REVIEW §8).
 *
 * `images.unoptimized` is what makes the server answer the route with a 404
 * before it reads a parameter (`next-server.js`, the `unoptimized` branch of
 * the image handler), so that is what is asserted — on the config object Next
 * is given, after the next-intl plugin has wrapped it.
 * `e2e/security-headers.spec.ts` asks the production build for the route and
 * expects the 404.
 *
 * An import of `next/image` is no longer checked for. With the endpoint off it
 * renders the source file as it is, in development and production alike, so
 * there is no longer a difference between the two for a guard to catch.
 */
describe("the image optimiser is switched off", () => {
  it("declares images.unoptimized", () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
  });

  it("does not hand the route to a custom loader instead", () => {
    // A loader is the other way Next 404s the route, and it moves image
    // requests somewhere this project does not review.
    expect(nextConfig.images?.loader).toBeUndefined();
    expect(nextConfig.images?.loaderFile).toBeUndefined();
  });
});
