"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";
import { Footer } from "@/components/Footer";

// Verificación en dos pasos (obligatoria para administradores): la primera
// vez se registra la app de autenticación con un código QR; después solo se
// pide el código de 6 dígitos.
export default function MfaPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) {
        setError(listError.message);
        setLoading(false);
        return;
      }
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) {
        setFactorId(verified.id);
      } else {
        // Registros a medias (QR mostrado pero nunca confirmado) se descartan.
        for (const f of data.all.filter((f) => f.factor_type === "totp" && f.status !== "verified")) {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
        const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: `Portal ${new Date().toISOString().slice(0, 10)}`,
        });
        if (enrollError) setError(enrollError.message);
        else {
          setFactorId(enrolled.id);
          setQr(enrolled.totp.qr_code);
          setSecret(enrolled.totp.secret);
        }
      }
      setLoading(false);
    })();
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setLoading(true);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (verifyError) {
      setError("Código incorrecto o vencido. Escribe el código que muestra ahora la app.");
      setLoading(false);
      return;
    }
    router.push("/panel");
    router.refresh();
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
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
              <h1 className="text-lg font-semibold text-rethink-cream">Verificación en dos pasos</h1>
              <p className="text-sm text-rethink-cream/60">
                {qr
                  ? "Escanea este código con Google Authenticator, Microsoft Authenticator o similar y escribe el código de 6 dígitos que aparece."
                  : "Escribe el código de 6 dígitos de tu app de autenticación."}
              </p>
            </div>
            {qr && (
              <div className="flex flex-col items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="Código QR para la app de autenticación" className="h-48 w-48 rounded bg-white p-2" />
                {secret && (
                  <p className="break-all text-center text-xs text-rethink-cream/60">
                    Sin cámara: ingresa esta clave en la app → {secret}
                  </p>
                )}
              </div>
            )}
            <div>
              <label className="label" htmlFor="code">
                Código
              </label>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                className="input"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={loading || !factorId} className="btn-primary">
              {loading ? "Verificando..." : "Verificar"}
            </button>
            <button type="button" onClick={signOut} className="text-sm text-rethink-cream/60 underline">
              Cerrar sesión
            </button>
          </form>
        </div>
      </div>
      <Footer />
    </div>
  );
}
