"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createDocumentAction, updateDocumentAction } from "@/lib/actions/whatsapp";
import { ActionState } from "@/lib/action-state";
import { Company, KbDocument } from "@/types/database";
import { CompanySelect, LevelSelect } from "@/components/whatsapp/LevelSelect";

const initialState: ActionState = { error: null };

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Procesando e indexando..." : editing ? "Guardar y reindexar" : "Agregar a la base"}
    </button>
  );
}

export function DocumentForm({
  companies,
  document,
}: {
  companies: Pick<Company, "id" | "name">[];
  document?: KbDocument;
}) {
  const editing = Boolean(document);
  const [state, formAction] = useFormState(
    editing ? updateDocumentAction : createDocumentAction,
    initialState
  );
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (!editing && submitted.current && state.error === null) formRef.current?.reset();
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
      {document && <input type="hidden" name="id" value={document.id} />}
      <div>
        <label className="label" htmlFor="title">
          Título
        </label>
        <input
          id="title"
          name="title"
          required
          defaultValue={document?.title}
          placeholder="Ficha técnica — Inhibidor RT-200"
          className="input"
        />
      </div>
      <div>
        <label className="label" htmlFor="category">
          Categoría
        </label>
        <input
          id="category"
          name="category"
          defaultValue={document?.category ?? ""}
          placeholder="Calderas, Torres, PTAR, Servicios, FAQ…"
          className="input"
        />
      </div>
      <LevelSelect defaultValue={document?.access_level} label="¿Quién puede recibir esta información?" />
      <CompanySelect
        companies={companies}
        defaultValue={document?.company_id}
        label="Exclusivo de una empresa (opcional)"
        emptyLabel="Todas las empresas"
      />
      {!editing && (
        <div>
          <label className="label" htmlFor="file">
            Archivo (PDF, Word, página web .html, TXT, Markdown o CSV — máx. 4 MB)
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".pdf,.doc,.docx,.xlsx,.xlsm,.pptx,.png,.jpg,.jpeg,.webp,.gif,.html,.htm,.txt,.md,.markdown,.csv,.json"
            className="input file:mr-3 file:rounded-md file:border-0 file:bg-rethink-orange/20 file:px-3 file:py-1 file:text-rethink-orange"
          />
        </div>
      )}
      <div>
        <label className="label" htmlFor="content">
          {editing ? "Contenido (texto que usa el bot)" : "…o pega el texto directamente"}
        </label>
        <textarea
          id="content"
          name="content"
          rows={editing ? 18 : 6}
          defaultValue={document?.content}
          required={editing}
          placeholder="Preguntas frecuentes, procedimientos, especificaciones…"
          className="input font-mono text-xs"
        />
      </div>
      <div>
        <label className="label" htmlFor="description">
          Nota interna (opcional, el bot no la ve)
        </label>
        <input id="description" name="description" defaultValue={document?.description ?? ""} className="input" />
      </div>
      {editing && (
        <label className="flex items-center gap-2 text-sm text-rethink-cream/80">
          <input type="checkbox" name="active" defaultChecked={document?.active} className="accent-rethink-orange" />
          Activo (el bot puede usarlo)
        </label>
      )}
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton editing={editing} />
    </form>
  );
}
