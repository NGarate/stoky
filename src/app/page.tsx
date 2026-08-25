import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEVICE_ID_COOKIE, isDeviceId } from "@/lib/device";
import { landingPath } from "@/lib/landing";

/**
 * The landing decision (`REDESIGN_PLAN.md` §5.1, Journey 8).
 *
 * This used to be four lines redirecting everybody to `/dashboard`. It is now
 * where the screen choice is honoured, and it is a server component doing it —
 * session, cookie, one row, redirect — so nobody ever sees a screen they did
 * not pick, not even for a frame. That is the reason the device id is a cookie
 * rather than `localStorage`: this function could not exist otherwise.
 *
 * It reads request data, so it can never prerender, which is correct and not a
 * limitation: a redirect that depends on who is asking has nothing to cache.
 */
export default async function Home() {
  const session = await auth();
  const userId = session?.user?.id;

  // Checked here rather than left to the destination. Every screen below
  // redirects an anonymous caller to `/login` anyway, but going straight there
  // saves a stranger a pointless round trip through a screen they cannot see.
  if (!userId) redirect("/login");

  const deviceId = (await cookies()).get(DEVICE_ID_COOKIE)?.value;
  const choice = isDeviceId(deviceId)
    ? await prisma.screenChoice.findUnique({
        where: { userId_deviceId: { userId, deviceId } },
        select: { screen: true },
      })
    : null;

  redirect(landingPath({ role: session?.user?.role, choice: choice?.screen }));
}
