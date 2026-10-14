"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { sendAgentMessageAction } from "@/lib/actions/whatsapp";
import { ActionState } from "@/lib/action-state";

const initialState: ActionState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary shrink-0">
      {pending ? "Enviando..." : "Enviar"}
    </button>
  );
}

export function AgentReplyForm({ contactId, windowOpen }: { contactId: string; windowOpen: boolean }) {
  const [state, formAction] = useFormState(sendAgentMessageAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current && state.error === null) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={(fd) => {
        submitted.current = true;
        formAction(fd);
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="id" value={contactId} />
      {!windowOpen && (
        <p className="rounded-lg bg-rethink-amber/10 px-3 py-2 text-xs text-rethink-amber">
          Pasaron más de 24 h desde el último mensaje del cliente. WhatsApp solo permite
          responder con texto libre dentro de esa ventana; fuera de ella hace falta una
          plantilla aprobada por Meta, así que este envío probablemente falle.
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          name="body"
          rows={2}
          required
          placeholder="Responder como asesor… (al enviar, el bot se pausa en este chat)"
          className="input"
        />
        <SubmitButton />
      </div>
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
    </form>
  );
}
