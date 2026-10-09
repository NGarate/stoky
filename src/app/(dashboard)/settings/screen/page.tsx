import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { ScreenChoiceForm } from "@/components/settings/ScreenChoiceForm";
import { DEVICE_ID_COOKIE, isDeviceId } from "@/lib/device";
import type { JSX } from "react";

/**
 * The other half of §5.1: "changeable from settings".
 *
 * A sub-page rather than a control inside `/settings`, for two reasons. The
 * settings page is a client component, and this question needs the server — the
 * current answer is a row keyed on a cookie no script can read. And the
 * sub-page is the shape this section already uses for anything needing its own
 * screen: locations, shops, people, unsent changes.
 *
 * **It is per device, and it says so.** Somebody changing this on their phone
 * has not changed it on the kitchen tablet, and the sentence under the heading
 * is the only place that fact is visible — a setting whose scope is invisible
 * is one people are surprised by later.
 *
 * **The confirmation is a live region holding the current answer**, not a
 * message that appears after a write. That follows the taxonomy D101 settled: a
 * persistent state belongs in a live region beside the control, and only an
 * event belongs in the snackbar. It also survives the mechanism — a first
 * attempt used a redirect back here carrying a flag, and Next keeps the URL
 * when a server action redirects to the route it was called from, so the flag
 * never arrived. The write had happened and only the sentence was missing,
 * which is the worst shape for this to fail in.
 */
export default async function ScreenSettingsPage(): Promise<JSX.Element> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const t = await getTranslations("start");
  const deviceId = (await cookies()).get(DEVICE_ID_COOKIE)?.value;
  const choice = isDeviceId(deviceId)
    ? await prisma.screenChoice.findUnique({
        where: { userId_deviceId: { userId, deviceId } },
        select: { screen: true },
      })
    : null;

  const currentName = choice
    ? t(
        choice.screen === "SHOPPING"
          ? "shopping"
          : choice.screen === "KITCHEN"
            ? "kitchen"
            : "dashboard",
      )
    : null;

  return (
    <PageShell width="form">
      <PageHeader
        back={{ href: "/settings", label: t("backToSettings") }}
        className="mb-0"
        intro={t("settingsDescription")}
        title={t("settingsTitle")}
      />

      {/* Permanent, and polite. It exists before there is anything to announce
          — a region created at the moment it has something to say is one some
          readers never announce, which is the same rule `SyncStatus` follows.
          Changing the choice changes this sentence, and that change is the
          confirmation. */}
      <p
        aria-live="polite"
        className="mt-4 rounded border border-border bg-muted px-4 py-3 text-foreground"
        role="status"
      >
        {currentName
          ? t("currentlyStartingAt", { screen: currentName })
          : t("notChosenYet")}
      </p>

      <div className="mt-6">
        <ScreenChoiceForm current={choice?.screen} then="stay" />
      </div>
    </PageShell>
  );
}
