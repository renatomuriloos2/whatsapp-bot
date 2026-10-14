import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Footer } from "@/components/Footer";
import { LogoutButton } from "@/components/LogoutButton";
import { NavLink } from "@/components/NavLink";
import { ThemeToggle } from "@/components/ThemeToggle";

export type NavItem = { href: string; label: string } | { group: string };

export function Shell({
  navItems,
  userEmail,
  accountHref,
  children,
}: {
  navItems: NavItem[];
  userEmail?: string;
  accountHref?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1">
        <aside
          data-theme="dark"
          className="hidden w-60 shrink-0 flex-col border-r border-white/10 bg-black/20 p-4 sm:flex"
        >
          <Logo className="mb-8 px-2" />
          <nav className="flex flex-1 flex-col gap-1">
            {navItems.map((item) =>
              "group" in item ? (
                <p
                  key={item.group}
                  className="mb-1 mt-4 px-3 text-[11px] font-medium uppercase tracking-wide text-rethink-cream/40 first:mt-0"
                >
                  {item.group}
                </p>
              ) : (
                <NavLink key={item.href} href={item.href}>
                  {item.label}
                </NavLink>
              )
            )}
          </nav>
          <ThemeToggle fullWidth />
        </aside>
        <div className="flex flex-1 flex-col">
          <header
            data-theme="dark"
            className="flex items-center justify-between border-b border-white/10 px-6 py-3 sm:hidden"
          >
            <Logo />
            <ThemeToggle />
          </header>
          <header className="flex items-center justify-end gap-3 border-b border-surface/10 px-6 py-3">
            {userEmail && (
              <span className="text-xs text-rethink-cream/60">{userEmail}</span>
            )}
            {accountHref && (
              <Link href={accountHref} className="btn-secondary text-xs">
                Mi cuenta
              </Link>
            )}
            <LogoutButton />
          </header>
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
      <Footer />
    </div>
  );
}
