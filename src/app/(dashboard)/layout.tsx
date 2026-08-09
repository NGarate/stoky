import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CompactNav } from "@/components/dashboard/CompactNav";
import { DashboardNav } from "@/components/dashboard/DashboardNav";

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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <DashboardNav />
      <CompactNav />
      <main className="mx-auto max-w-7xl p-4 pb-28 md:pb-8 md:pl-36 lg:pb-4 lg:pl-4">
        {children}
      </main>
    </div>
  );
}
