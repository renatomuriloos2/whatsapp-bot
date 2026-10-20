"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enrichPendingAction } from "@/lib/actions/whatsapp";

/** Genera la ficha con IA de todos los documentos pendientes, por tandas. */
export function EnrichButton({ pending }: { pending: number }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    let total = 0;
    for (let i = 0; i < 100; i++) {
      const res = await enrichPendingAction().catch(() => ({ processed: 0, remaining: 0, error: "Error inesperado." }));
      total += res.processed;
      if (res.error) {
        setStatus(res.error);
        break;
      }
      setStatus(`Procesados ${total} · faltan ${res.remaining}`);
      if (res.remaining === 0 || res.processed === 0) break;
    }
    setRunning(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={run} disabled={running || pending === 0} className="btn-secondary">
        {running ? "Analizando documentos…" : `Analizar ${pending} documento${pending === 1 ? "" : "s"} con IA`}
      </button>
      {status && <p className="text-xs text-rethink-cream/70">{status}</p>}
    </div>
  );
}
