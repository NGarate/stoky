import type { PrismaClient } from "@prisma/client";
import { deviceLabel, type DeviceLabel } from "@/lib/auth/device-label";
import type { LandingScreen } from "@prisma/client";

/**
 * One account's live sessions, as a screen may show them — what a person
 * reads in **Tus dispositivos** (`auth.listSessions`, D143) and an admin reads
 * in a member's sessions (`household.memberSessions`, D145).
 *
 * One reading for both, so that what an admin is shown can never be more
 * than what the person is shown about themselves.
 *
 * **Never a token, never the device id.** The select names its columns, so a
 * column added later is not listed until somebody decides it should be:
 * `token` is the credential the cookie signs, and `deviceId` is the
 * `stoky_device` cookie's value, read here only to join `ScreenChoice`. What a
 * session is shown as is the browser and system its User-Agent names
 * (`deviceLabel`) and, where the device has chosen one, the screen it opens
 * on — which is what tells the kitchen tablet from a phone. The screen is the
 * one *this account* chose on that device: a shared tablet another person
 * chose a screen on is not named by their choice.
 *
 * Expired rows are left out: they are sessions that have ended and are only
 * waiting to be deleted (D139). `signedInAt` is `authenticatedAt`, not
 * `createdAt`, which Better Auth resets when it re-creates a session.
 * `lastUsedAt` is `updatedAt`, as coarse as the writes that move it (D140).
 *
 * Whether a row is the session asking is not here: only the person's own list
 * has a "this one", and it adds it.
 */
export interface ListedSession {
  id: string;
  device: DeviceLabel;
  screen: LandingScreen | null;
  signedInAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  remembered: boolean;
}

type ListDb = Pick<PrismaClient, "session" | "screenChoice">;

export async function liveSessionsOf(
  db: ListDb,
  userId: string,
): Promise<ListedSession[]> {
  const rows = await db.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      authenticatedAt: true,
      updatedAt: true,
      expiresAt: true,
      userAgent: true,
      persistent: true,
      deviceId: true,
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });

  const deviceIds = [
    ...new Set(rows.flatMap((row) => (row.deviceId ? [row.deviceId] : []))),
  ];
  const choices =
    deviceIds.length === 0
      ? []
      : await db.screenChoice.findMany({
          where: { userId, deviceId: { in: deviceIds } },
          select: { deviceId: true, screen: true },
        });
  const screenOf = new Map(
    choices.map((choice) => [choice.deviceId, choice.screen]),
  );

  return rows.map((row) => ({
    id: row.id,
    device: deviceLabel(row.userAgent),
    screen: (row.deviceId && screenOf.get(row.deviceId)) || null,
    signedInAt: row.authenticatedAt,
    lastUsedAt: row.updatedAt,
    expiresAt: row.expiresAt,
    remembered: row.persistent,
  }));
}
