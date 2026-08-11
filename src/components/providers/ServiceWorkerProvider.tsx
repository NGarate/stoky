"use client";

import { useEffect } from "react";
import {
  disableServiceWorker,
  registerServiceWorker,
  shouldRegisterServiceWorker,
} from "@/lib/sw/register";

/**
 * Registers the worker outside development, and tears it down inside it.
 *
 * The teardown is not symmetry for its own sake: `public/sw.js` is served in
 * development too, so a developer who once ran a production build has a worker
 * serving chunks that no longer exist, and nothing on screen says so.
 */
export function ServiceWorkerProvider(): null {
  useEffect(() => {
    const register = shouldRegisterServiceWorker({
      nodeEnv: process.env.NODE_ENV,
      forced: window.__STOKY_SW_FORCE__,
    });

    void (register ? registerServiceWorker() : disableServiceWorker());
  }, []);

  return null;
}
