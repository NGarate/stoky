"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { PreferencesCluster } from "@/components/ui/PreferencesCluster";

export function DashboardNav() {
  const t = useTranslations("navigation");
  const pathname = usePathname();

  const navItems = [
    { href: "/dashboard", label: t("dashboard") },
    { href: "/inventory", label: t("inventory") },
    { href: "/products", label: t("products") },
    { href: "/receipts", label: t("receipts") },
    { href: "/shopping", label: t("shopping") },
    { href: "/prices", label: t("prices") },
    { href: "/settings", label: t("settings") },
  ];

  return (
    <nav className="border-b border-border bg-card">
      {/* `flex-wrap` because the preferences cluster is wider than the locale
          select it replaces; without it the row overflows horizontally, which
          DESIGN_AUDIT A3.3 counts as a defect rather than a nit. */}
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="text-xl font-bold text-primary">
            Stoky
          </Link>
          <ul className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    pathname === item.href || pathname.startsWith(`${item.href}/`)
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <PreferencesCluster />
      </div>
    </nav>
  );
}
