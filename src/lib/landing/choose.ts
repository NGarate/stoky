"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEVICE_ID_COOKIE, isDeviceId } from "@/lib/device";
import { SCREEN_PATHS, isLandingScreen } from "@/lib/landing";

/**
 * Record which screen this person wants on this device, and take them there.
 *
 * A server action rather than a tRPC procedure, and that is the point of the
 * whole design: the form posts, the row is written, and the redirect happens —
 * all on the server, before anything renders. `/start` therefore needs no
 * client JavaScript at all, which is worth having on the one screen a person
 * meets before they have any reason to trust the application.
 *
 * The key is the pair, which is what makes Journey 8's shared tablet work: the
 * row is (this account, this browser), so the next account to sign in here
 * finds nothing under its own key and is asked.
 */
export async function chooseScreen(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const screen = formData.get("screen");
  // Refused rather than defaulted. A value that is not one of the three is
  // either a stale form or somebody posting by hand, and quietly picking a
  // screen for them would write a preference they never expressed.
  if (!isLandingScreen(screen)) redirect("/start");

  const deviceId = (await cookies()).get(DEVICE_ID_COOKIE)?.value;

  // No device id means no cookie, which means the browser refused it or the
  // request never went through the middleware. There is nothing to key a
  // preference on, so the choice cannot be remembered — but it can still be
  // honoured for this navigation, which is better than an error page for
  // somebody who just answered a question.
  if (isDeviceId(deviceId)) {
    await prisma.screenChoice.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      create: { userId, deviceId, screen },
      update: { screen },
    });
  }

  redirect(SCREEN_PATHS[screen]);
}
