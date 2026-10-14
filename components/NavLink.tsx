"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive =
    href === "/panel"
      ? pathname === href
      : pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={cn(
        "block rounded-lg px-3 py-2 text-sm font-medium transition",
        isActive
          ? "bg-rethink-orange/15 text-rethink-orange"
          : "text-rethink-cream/70 hover:bg-white/5 hover:text-rethink-cream"
      )}
    >
      {children}
    </Link>
  );
}
