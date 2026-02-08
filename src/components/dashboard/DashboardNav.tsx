"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";

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
    <nav className="border-b bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="text-xl font-bold text-blue-600">
            Stoky
          </Link>
          <ul className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    pathname === item.href || pathname.startsWith(`${item.href}/`)
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-4">
          <LocaleSwitcher />
        </div>
      </div>
    </nav>
  );
}
