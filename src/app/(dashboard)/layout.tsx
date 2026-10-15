import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { CompactNav } from "@/components/dashboard/CompactNav";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { SessionKeepAlive } from "@/components/session/SessionKeepAlive";
import { ComposerProvider } from "@/components/offline/Composer";
import { WriteQueueProvider } from "@/components/offline/WriteQueueProvider";
import { SyncStatus } from "@/components/offline/SyncStatus";
import { ShellCacheGuard } from "@/components/session/ShellCacheGuard";
import { PreferencesSync } from "@/components/session/PreferencesSync";
import { ReadCache } from "@/components/offline/ReadCache";
import { SnackbarProvider } from "@/components/ui/snackbar";

// Entering this shell waits for the session and account preferences. Opt out
// at this layout boundary; pages within it still validate instant navigation.
export const instant = false;

/**
 * The authenticated shell.
 *
 * Three navigations are mounted and exactly one is visible, chosen by viewing
 * distance rather than by width (DESIGN_AUDIT A3.5):
 *
 * | Width | Control | Where the padding goes |
 * |---|---|---|
 * | base → `md` | bottom bar | `pb-28`, so the last row is not under the bar |
 * | `md` → `lg` | left rail (`w-32`) | `md:pl-36`, clearing the rail |
 * | `lg` and up | top bar | back to a plain `p-4` |
 *
 * The desktop bar is first in the DOM so keyboard order on the tier that uses
 * it starts with navigation, and so href-based selectors keep resolving to the
 * visible control there.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  // Read here rather than asked for by the component that needs it. The
  // snackbar duration belongs to the account, and the thing that reads it sits
  // under every screen — a query per screen for a preference is a loading
  // state behind a setting. This layout has already awaited the session, so
  // the row is one indexed lookup away.
  //
  // A missing row is a session for a deleted account; the default is the right
  // answer and signing out is somebody else's job.
  const preferences = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { snackbarDuration: true },
  });

  return (
    // The only place that has awaited `auth()`. Every change composed below
    // here carries the account and the household it was composed under, and
    // the server refuses a mismatch — so this is where they enter the client.
    <ComposerProvider
      composer={{
        userId: session.user.id,
        householdId: session.user.householdId ?? null,
      }}
    >
      <WriteQueueProvider>
        {/* Inside the queue provider, because an undo snackbar asks the queue
            how long its change can still be taken back. Its viewport renders
            after <main>, so it never intrudes on the tab order of someone
            working down the page — F8 is how you reach it deliberately. */}
        <SnackbarProvider>
        <div className="min-h-screen bg-background text-foreground">
          <DashboardNav />
          <CompactNav />
          {/* WCAG 2.2.6: an idle session must say so before it takes work with it. */}
          <SessionKeepAlive expiresAt={session.expires} kind={session.expiresKind} />
        {/* The cached shell belongs to this account and no other. */}
        <ShellCacheGuard userId={session.user.id} />
        {/* Renders nothing; hands the account's answer to the store the
            snackbar reads. */}
        <PreferencesSync
          snackbarDuration={preferences?.snackbarDuration ?? "default"}
        />
        {/* The last answer each screen showed, so opening without a signal
            shows real data rather than the paused panel. */}
        <ReadCache />
          <main className="mx-auto max-w-7xl p-4 pb-28 md:pb-8 md:pl-36 lg:pb-4 lg:pl-4">
            {/* Above the content, because what it says sometimes needs doing
                before what is below it can be trusted. */}
            <SyncStatus />
            {children}
          </main>
        </div>
        </SnackbarProvider>
      </WriteQueueProvider>
    </ComposerProvider>
  );
}
