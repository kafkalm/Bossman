"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import {
  Users,
  FolderKanban,
  LayoutDashboard,
  BarChart3,
  Settings,
  Sparkles,
} from "lucide-react";

const navKeys = [
  { key: "nav.dashboard", href: "/", icon: LayoutDashboard },
  { key: "nav.projects", href: "/project", icon: FolderKanban },
  { key: "nav.team", href: "/team", icon: Users },
  { key: "nav.skills", href: "/skills", icon: Sparkles },
  { key: "nav.analytics", href: "/analytics", icon: BarChart3 },
  { key: "nav.settings", href: "/settings", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const { t } = useTranslation();

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-card">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
          B
        </div>
        <span className="text-lg font-bold">Bossman</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {navKeys.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {t(item.key)}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t p-4">
        <p className="text-xs text-muted-foreground">Bossman v0.1.0</p>
      </div>
    </aside>
  );
}
