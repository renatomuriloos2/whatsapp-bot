import { requireAppUser } from "@/lib/auth";
import { Shell, NavItem } from "@/components/Shell";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const appUser = await requireAppUser();
  const isAdmin = appUser.role === "admin";

  const navItems: NavItem[] = [
    { href: "/panel", label: "Panel" },
    { href: "/conversaciones", label: "Conversaciones" },
    { href: "/conocimiento", label: "Base de conocimiento" },
    { href: "/empresas", label: "Empresas" },
    ...(isAdmin
      ? [
          { group: "Administración" },
          { href: "/costos", label: "Costos de IA" },
          { href: "/probar", label: "Probar el bot" },
          { href: "/configuracion", label: "Configuración" },
          { href: "/usuarios", label: "Usuarios" },
        ]
      : []),
  ];

  return (
    <Shell navItems={navItems} userEmail={appUser.email} accountHref="/cuenta">
      {children}
    </Shell>
  );
}
