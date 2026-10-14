"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createCompanyAction } from "@/lib/actions/whatsapp";
import { ActionState } from "@/lib/action-state";

const initialState: ActionState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Guardando..." : "Agregar empresa"}
    </button>
  );
}

export function CompanyForm() {
  const [state, formAction] = useFormState(createCompanyAction, initialState);
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
      className="flex flex-col gap-3"
    >
      <div>
        <label className="label" htmlFor="name">
          Nombre de la empresa
        </label>
        <input id="name" name="name" required placeholder="San Juan Textiles" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="notes">
          Notas internas (opcional)
        </label>
        <input id="notes" name="notes" className="input" />
      </div>
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton />
    </form>
  );
}
