import { SUPABASE_URL } from "@/lib/supabase/url";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

// /api/whatsapp/* y /api/cron/* no usan sesión: Meta y el cron los llaman
// sin cookies. Cada ruta valida su propia credencial (firma de Meta o
// Authorization: Bearer CRON_SECRET).
const PUBLIC_PATHS = ["/login", "/auth", "/api/whatsapp", "/api/cron"];

// Secciones que solo ve el rol admin (los agentes vuelven al panel).
const ADMIN_ONLY = ["/costos", "/probar", "/configuracion", "/usuarios", "/onedrive"];

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/whatsapp") || pathname.startsWith("/api/cron")) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    return NextResponse.redirect(url);
  };

  if (!user) {
    return isPublicPath ? response : redirectTo("/login");
  }

  if (pathname === "/login" || pathname === "/") return redirectTo("/panel");

  if (ADMIN_ONLY.some((p) => pathname.startsWith(p))) {
    const { data: appUser } = await supabase.from("users").select("role").eq("id", user.id).single();
    if (appUser?.role !== "admin") return redirectTo("/panel");
  }

  return response;
}
