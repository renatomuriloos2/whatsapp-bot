"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function ChangePasswordForm() {
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError("No se pudo actualizar la contraseña. Intenta de nuevo.");
      return;
    }

    setPassword("");
    setConfirmPassword("");
    setSuccess(true);
  }

  return (
    <form onSubmit={handleSubmit} className="card flex max-w-sm flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium text-rethink-cream">Cambiar contraseña</h3>
        <p className="text-xs text-rethink-cream/50">Aplica de inmediato a tu cuenta.</p>
      </div>
      <div>
        <label className="label" htmlFor="new-password">
          Nueva contraseña
        </label>
        <input
          id="new-password"
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
        <label className="label" htmlFor="confirm-password">
          Confirmar contraseña
        </label>
        <input
          id="confirm-password"
          type="password"
          required
          minLength={8}
          className="input"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-rethink-green">Contraseña actualizada.</p>}
      <button type="submit" disabled={submitting} className="btn-primary self-start">
        {submitting ? "Guardando..." : "Guardar contraseña"}
      </button>
    </form>
  );
}
