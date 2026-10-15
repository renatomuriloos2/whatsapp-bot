"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { addSourceAction } from "@/lib/actions/sources";
import { ActionState } from "@/lib/action-state";
import { Company } from "@/types/database";
import { CompanySelect, LevelSelect } from "@/components/whatsapp/LevelSelect";

const initialState: ActionState = { error: null };

/** Botón de envío que muestra un texto mientras la acción corre. */
export function PendingButton({
  children,
  pendingText,
  className = "btn-secondary",
}: {
  children: React.ReactNode;
  pendingText: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingText : children}
    </button>
  );
}

export function AddSourceForm({ companies }: { companies: Pick<Company, "id" | "name">[] }) {
  const [state, formAction] = useFormState(addSourceAction, initialState);
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
        <label className="label" htmlFor="share_url">
          Vínculo de la carpeta (Google Drive u OneDrive)
        </label>
        <input
          id="share_url"
          name="share_url"
          required
          placeholder="https://drive.google.com/drive/folders/…"
          className="input"
        />
      </div>
      <div>
        <label className="label" htmlFor="source_name">
          Nombre (opcional, por defecto el de la carpeta)
        </label>
        <input id="source_name" name="name" className="input" />
      </div>
      <LevelSelect id="source_level" label="Nivel de acceso de sus documentos" />
      <CompanySelect
        id="source_company"
        companies={companies}
        label="Exclusivo de una empresa (opcional)"
        emptyLabel="Todas las empresas"
      />
      <div>
        <label className="label" htmlFor="source_category">
          Categoría fija (opcional)
        </label>
        <input
          id="source_category"
          name="category"
          placeholder="Vacío = usar el nombre de cada subcarpeta"
          className="input"
        />
      </div>
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      <PendingButton className="btn-primary" pendingText="Conectando y leyendo archivos…">
        Conectar carpeta
      </PendingButton>
    </form>
  );
}
