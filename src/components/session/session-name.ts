"use client";

import { useTranslations } from "next-intl";
import type { LandingScreen } from "@prisma/client";

/** What a listed session carries that names it. */
export interface NamedSession {
  device: { browser: string | null; os: string | null };
  screen: LandingScreen | null;
}

/**
 * What a session is called on screen, in one place: a person's own
 * **Tus dispositivos** (`DeviceList`) and an admin's view of a member's
 * sessions (`MemberSessionsDialog`) name the same row the same way.
 *
 * `nameOf` is the screen the device opens on, where it has chosen one — that
 * is what tells the kitchen tablet from a phone of the same make — else
 * `deviceName`, the browser and system its User-Agent names, else "unknown".
 * Never a token or the device id, which the server does not send.
 */
export function useSessionName(): {
  nameOf: (session: NamedSession) => string;
  deviceName: (session: NamedSession) => string;
} {
  const t = useTranslations("security");

  function deviceName(session: NamedSession): string {
    const { browser, os } = session.device;
    if (browser && os) return t("deviceOn", { browser, os });
    return browser ?? os ?? t("deviceUnknown");
  }

  function nameOf(session: NamedSession): string {
    if (session.screen) return t(`screen${session.screen}`);
    return deviceName(session);
  }

  return { nameOf, deviceName };
}
