"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";
import { Footer } from "@/components/Footer";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      // Supabase devuelve el mismo tipo de error para causas muy distintas;
      // se distinguen las comunes para que se sepa qué revisar.
      const msg = signInError.message.toLowerCase();
      if (msg.includes("email not confirmed")) {
        setError(
          "Tu correo aún no está confirmado. En Supabase → Authentication → Users, confirma el usuario (o créalo de nuevo marcando \"Auto Confirm User\")."
        );
      } else if (msg.includes("invalid api key") || msg.includes("fetch")) {
        setError(
          "El portal no logra conectarse a Supabase. Revisa en Vercel NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY y vuelve a desplegar."
        );
      } else if (msg.includes("invalid login credentials")) {
        setError(
          "Correo o contraseña incorrectos. Verifica que el usuario exista en el proyecto de Supabase del bot (Authentication → Users)."
        );
      } else {
        setError(`No se pudo iniciar sesión: ${signInError.message}`);
      }
      setLoading(false);
      return;
    }

    const { data: appUser } = await supabase
      .from("users")
      .select("role")
      .eq("id", data.user.id)
      .single();

    if (!appUser) {
      await supabase.auth.signOut();
      setError("Tu cuenta no tiene acceso a este portal. Pide a un administrador que te dé acceso.");
      setLoading(false);
      return;
    }

    router.push("/panel");
    router.refresh();
  }

  return (
    <div data-theme="dark" className="flex min-h-screen flex-col bg-rethink-bg">
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center">
            <Logo size="lg" />
          </div>
          <form onSubmit={handleSubmit} className="card flex flex-col gap-4">
            <div>
              <h1 className="text-lg font-semibold text-rethink-cream">Iniciar sesión</h1>
              <p className="text-sm text-rethink-cream/60">
                Asistente de WhatsApp · Rethink
              </p>
            </div>
            <div>
              <label className="label" htmlFor="email">
                Correo
              </label>
              <input
                id="email"
                type="email"
                required
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                required
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? "Ingresando..." : "Ingresar"}
            </button>
          </form>
        </div>
      </div>
      <Footer />
    </div>
  );
}
