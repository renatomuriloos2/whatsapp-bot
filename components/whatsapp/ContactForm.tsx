"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createContactAction, updateContactAction } from "@/lib/actions/whatsapp";
import { ActionState } from "@/lib/action-state";
import { Company, WaContact } from "@/types/database";
import { CompanySelect, LevelSelect } from "@/components/whatsapp/LevelSelect";

const initialState: ActionState = { error: null };

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Guardando..." : editing ? "Guardar cambios" : "Registrar contacto"}
    </button>
  );
}

export function ContactForm({
  companies,
  contact,
}: {
  companies: Pick<Company, "id" | "name">[];
  contact?: WaContact;
}) {
  const editing = Boolean(contact);
  const [state, formAction] = useFormState(
    editing ? updateContactAction : createContactAction,
    initialState
  );
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (!submitted.current || state.error !== null) return;
    if (!editing) formRef.current?.reset();
  }, [state, editing]);

  return (
    <form
      ref={formRef}
      action={(fd) => {
        submitted.current = true;
        formAction(fd);
      }}
      className="flex flex-col gap-3"
    >
      {contact ? (
        <input type="hidden" name="id" value={contact.id} />
      ) : (
        <div>
          <label className="label" htmlFor="phone">
            Número de WhatsApp
          </label>
          <input id="phone" name="phone" required placeholder="+57 300 123 4567" className="input" />
        </div>
      )}
      <div>
        <label className="label" htmlFor="display_name">
          Nombre
        </label>
        <input
          id="display_name"
          name="display_name"
          defaultValue={contact?.display_name ?? ""}
          placeholder={contact?.profile_name ?? "Ing. Laura Gómez"}
          className="input"
        />
      </div>
      <CompanySelect
        companies={companies}
        defaultValue={contact?.company_id}
        label="Empresa"
        emptyLabel="Sin empresa (prospecto)"
      />
      <LevelSelect defaultValue={contact?.access_level} />
      <div>
        <label className="label" htmlFor="status">
          Estado
        </label>
        <select id="status" name="status" defaultValue={contact?.status ?? "activo"} className="input">
          <option value="activo">Activo — el bot le responde</option>
          <option value="pendiente">Pendiente — espera aprobación</option>
          <option value="bloqueado">Bloqueado — se ignoran sus mensajes</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="notes">
          Notas internas
        </label>
        <textarea id="notes" name="notes" rows={2} defaultValue={contact?.notes ?? ""} className="input" />
      </div>
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      {editing && submitted.current && state.error === null && (
        <p className="text-sm text-rethink-green">Cambios guardados.</p>
      )}
      <SubmitButton editing={editing} />
    </form>
  );
}
