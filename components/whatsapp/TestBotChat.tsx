"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { testBotAction, TestBotState } from "@/lib/actions/whatsapp";
import { Company } from "@/types/database";
import { CompanySelect, LevelSelect } from "@/components/whatsapp/LevelSelect";
import { formatUsd, modelLabel } from "@/lib/ai/models";
import { ChatBubble } from "@/components/whatsapp/ChatBubble";

const initialState: TestBotState = { error: null, history: [], last: null };

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary shrink-0">
      {pending ? "Pensando..." : "Enviar"}
    </button>
  );
}

export function TestBotChat({ companies }: { companies: Pick<Company, "id" | "name">[] }) {
  const [state, formAction] = useFormState(testBotAction, initialState);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.error && inputRef.current) inputRef.current.value = "";
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [state]);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
      <div className="card flex min-h-[420px] flex-col">
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto pb-4">
          {state.history.length === 0 ? (
            <p className="m-auto max-w-sm text-center text-sm text-rethink-cream/50">
              Escribe una pregunta como lo haría un cliente. El bot responde con la configuración y
              la base de conocimiento actuales, filtrada por el nivel que elijas a la derecha.
            </p>
          ) : (
            state.history.map((turn, i) => (
              <ChatBubble key={i} outgoing={turn.role === "assistant"} author={turn.role === "assistant" ? "Bot" : "Tú"}>
                {turn.text}
              </ChatBubble>
            ))
          )}
          <div ref={bottomRef} />
        </div>
        {state.error && <p className="mb-2 text-sm text-red-400">{state.error}</p>}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            name="message"
            rows={2}
            placeholder="¿Cuál es la dosis recomendada de inhibidor para una caldera de 200 BHP?"
            className="input"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <SendButton />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="card flex flex-col gap-3">
          <h3 className="text-sm font-medium text-rethink-cream">Simular contacto</h3>
          <LevelSelect />
          <CompanySelect companies={companies} label="Empresa" emptyLabel="Sin empresa" />
          <button type="submit" name="reset" value="true" formNoValidate className="btn-secondary">
            Nueva conversación
          </button>
        </div>

        {state.last && (
          <div className="card text-sm">
            <h3 className="mb-3 text-sm font-medium text-rethink-cream">Última respuesta</h3>
            <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
              <dt className="text-rethink-cream/50">Modelo</dt>
              <dd className="text-right">{modelLabel(state.last.model)}</dd>
              <dt className="text-rethink-cream/50">Costo</dt>
              <dd className="text-right tabular-nums">{formatUsd(state.last.costUsd, 4)}</dd>
              <dt className="text-rethink-cream/50">Tokens entrada</dt>
              <dd className="text-right tabular-nums">{state.last.inputTokens.toLocaleString("es-CO")}</dd>
              <dt className="text-rethink-cream/50">…desde caché</dt>
              <dd className="text-right tabular-nums">{state.last.cacheReadTokens.toLocaleString("es-CO")}</dd>
              <dt className="text-rethink-cream/50">Tokens salida</dt>
              <dd className="text-right tabular-nums">{state.last.outputTokens.toLocaleString("es-CO")}</dd>
              <dt className="text-rethink-cream/50">Búsquedas</dt>
              <dd className="text-right tabular-nums">{state.last.toolCalls}</dd>
              <dt className="text-rethink-cream/50">Tiempo</dt>
              <dd className="text-right tabular-nums">{(state.last.latencyMs / 1000).toFixed(1)} s</dd>
            </dl>
            {state.last.sources.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-rethink-cream/50">Documentos consultados</p>
                <ul className="list-disc pl-4 text-xs text-rethink-cream/80">
                  {state.last.sources.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {state.last.escalation && (
              <p className="mt-3 rounded-lg bg-rethink-amber/10 px-3 py-2 text-xs text-rethink-amber">
                Derivaría a un asesor: {state.last.escalation}
              </p>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
