"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";
import { Footer } from "@/components/Footer";

type Status = "processing" | "set-password" | "error" | "redirecting";

export default function AuthCallbackPage() {
  const router = useRouter();
  const supabase = createClient();
  const [status, setStatus] = useState<Status>("processing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(hash);

    const errorDescription = params.get("error_description");
    if (errorDescription) {
      setErrorMessage(decodeURIComponent(errorDescription.replace(/\+/g, " ")));
      setStatus("error");
      return;
    }

    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type = params.get("type");

    if (!accessToken || !refreshToken) {
      setErrorMessage("El enlace no es válido o ya fue usado.");
      setStatus("error");
      return;
    }

    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        window.history.replaceState(null, "", window.location.pathname);

        if (error) {
          setErrorMessage("El enlace expiró o ya fue usado. Pide uno nuevo.");
          setStatus("error");
          return;
        }

        if (type === "recovery" || type === "invite") {
          setStatus("set-password");
        } else {
          setStatus("redirecting");
          router.replace("/");
          router.refresh();
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (password.length < 8) {
      setSubmitError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setSubmitError("Las contraseñas no coinciden.");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (error) {
      setSubmitError("No se pudo guardar la contraseña. Intenta de nuevo.");
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <div data-theme="dark" className="flex min-h-screen flex-col bg-rethink-bg">
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center">
            <Logo size="lg" />
          </div>

          {(status === "processing" || status === "redirecting") && (
            <div className="card text-center text-sm text-rethink-cream/70">
              Verificando enlace...
            </div>
          )}

          {status === "error" && (
            <div className="card flex flex-col gap-3">
              <p className="text-sm text-red-400">{errorMessage}</p>
              <a href="/login" className="btn-secondary self-start">
                Volver a iniciar sesión
              </a>
            </div>
          )}

          {status === "set-password" && (
            <form onSubmit={handleSetPassword} className="card flex flex-col gap-4">
              <div>
                <h1 className="text-lg font-semibold text-rethink-cream">Crea tu contraseña</h1>
                <p className="text-sm text-rethink-cream/60">
                  Para terminar de activar tu cuenta del portal de WhatsApp de Rethink.
                </p>
              </div>
              <div>
                <label className="label" htmlFor="password">
                  Nueva contraseña
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="label" htmlFor="confirmPassword">
                  Confirmar contraseña
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  required
                  minLength={8}
                  className="input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              {submitError && <p className="text-sm text-red-400">{submitError}</p>}
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? "Guardando..." : "Guardar contraseña"}
              </button>
            </form>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}
