"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createDocumentAction } from "@/lib/actions/whatsapp";
import { Company } from "@/types/database";
import { CompanySelect, LevelSelect } from "@/components/whatsapp/LevelSelect";
import { cn } from "@/lib/utils";

const SUPPORTED = /\.(pdf|docx?|html?|txt|md|markdown|csv|json|png|jpe?g|webp|gif)$/i;
// Vercel limita cada petición a 4.5 MB; cada archivo viaja en su propia petición.
const MAX_BYTES = 4 * 1024 * 1024;

type ItemStatus = "pendiente" | "subiendo" | "listo" | "omitido" | "error";

interface Item {
  file: File;
  path: string;
  status: ItemStatus;
  message?: string;
}

function titleFromName(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Carpeta inmediata del archivo dentro de la carpeta elegida (sirve de categoría). */
function folderOf(path: string): string | null {
  const parts = path.split("/");
  return parts.length > 2 ? parts[parts.length - 2] : null;
}

const STATUS_STYLE: Record<ItemStatus, string> = {
  pendiente: "text-rethink-cream/50",
  subiendo: "text-rethink-amber",
  listo: "text-rethink-green",
  omitido: "text-rethink-cream/50",
  error: "text-red-400",
};

const STATUS_TEXT: Record<ItemStatus, string> = {
  pendiente: "En espera",
  subiendo: "Subiendo…",
  listo: "Listo",
  omitido: "Omitido",
  error: "Error",
};

export function BulkUploadForm({
  companies,
  existingFileNames,
}: {
  companies: Pick<Company, "id" | "name">[];
  existingFileNames: string[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);

  function pick(files: FileList | null) {
    if (!files) return;
    const existing = new Set(existingFileNames.map((n) => n.toLowerCase()));
    setItems(
      Array.from(files)
        .filter((f) => !f.name.startsWith(".") && !f.name.startsWith("~$"))
        .map((file) => {
          const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
          if (!SUPPORTED.test(file.name)) {
            return { file, path, status: "omitido" as const, message: "Formato no soportado" };
          }
          if (file.size > MAX_BYTES) {
            return { file, path, status: "omitido" as const, message: "Pesa más de 4 MB" };
          }
          if (existing.has(file.name.toLowerCase())) {
            return { file, path, status: "omitido" as const, message: "Ya estaba subido" };
          }
          return { file, path, status: "pendiente" as const };
        })
    );
  }

  async function run() {
    const form = formRef.current;
    if (!form) return;
    const settings = new FormData(form);
    const defaultCategory = String(settings.get("category") ?? "").trim();
    const folderAsCategory = settings.get("folder_category") === "on";
    setRunning(true);

    // Uno por uno: cada archivo se extrae e indexa en el servidor, y así
    // ninguno supera el límite de tamaño de una petición.
    for (let i = 0; i < items.length; i++) {
      if (items[i].status !== "pendiente") continue;
      setItems((prev) => prev.map((it, j) => (j === i ? { ...it, status: "subiendo" } : it)));

      const { file, path } = items[i];
      const fd = new FormData();
      fd.set("title", titleFromName(file.name));
      fd.set("category", (folderAsCategory && folderOf(path)) || defaultCategory);
      fd.set("access_level", String(settings.get("access_level") ?? "publico"));
      fd.set("company_id", String(settings.get("company_id") ?? ""));
      fd.set("file", file);

      let status: ItemStatus = "listo";
      let message: string | undefined;
      try {
        const res = await createDocumentAction({ error: null }, fd);
        if (res.error) {
          status = "error";
          message = res.error;
        }
      } catch (err) {
        status = "error";
        message = err instanceof Error ? err.message : "Error inesperado";
      }
      setItems((prev) => prev.map((it, j) => (j === i ? { ...it, status, message } : it)));
    }

    setRunning(false);
    router.refresh();
  }

  const pending = items.filter((i) => i.status === "pendiente").length;
  const done = items.filter((i) => i.status === "listo").length;
  const failed = items.filter((i) => i.status === "error").length;

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="bulk-files">
            Elegir archivos
          </label>
          <input
            id="bulk-files"
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif,.html,.htm,.txt,.md,.markdown,.csv,.json"
            disabled={running}
            onChange={(e) => pick(e.target.files)}
            className="input file:mr-3 file:rounded-md file:border-0 file:bg-rethink-orange/20 file:px-3 file:py-1 file:text-rethink-orange"
          />
        </div>
        <div>
          <label className="label" htmlFor="bulk-folder">
            …o una carpeta completa (incluye subcarpetas)
          </label>
          <input
            id="bulk-folder"
            type="file"
            multiple
            disabled={running}
            onChange={(e) => pick(e.target.files)}
            className="input file:mr-3 file:rounded-md file:border-0 file:bg-rethink-orange/20 file:px-3 file:py-1 file:text-rethink-orange"
            {...{ webkitdirectory: "", directory: "" }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <LevelSelect id="bulk-level" label="Nivel de acceso para todos" />
        <CompanySelect
          id="bulk-company"
          companies={companies}
          label="Exclusivo de una empresa (opcional)"
          emptyLabel="Todas las empresas"
        />
        <div>
          <label className="label" htmlFor="bulk-category">
            Categoría
          </label>
          <input id="bulk-category" name="category" placeholder="Fichas técnicas, MSDS…" className="input" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-rethink-cream/80">
        <input type="checkbox" name="folder_category" defaultChecked className="accent-rethink-orange" />
        Si subo una carpeta, usar el nombre de cada subcarpeta como categoría
      </label>

      {items.length > 0 && (
        <div className="max-h-72 overflow-y-auto rounded-lg border border-surface/10">
          <table className="w-full text-xs">
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-b border-white/5 last:border-0">
                  <td className="px-3 py-1.5 text-rethink-cream/80">{it.path}</td>
                  <td className={cn("whitespace-nowrap px-3 py-1.5 text-right", STATUS_STYLE[it.status])}>
                    {STATUS_TEXT[it.status]}
                    {it.message ? ` · ${it.message}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={run} disabled={running || pending === 0} className="btn-primary">
          {running ? "Subiendo e indexando…" : `Subir ${pending} archivo${pending === 1 ? "" : "s"}`}
        </button>
        {items.length > 0 && (
          <p className="text-xs text-rethink-cream/60">
            {done} listos · {failed} con error · {items.length - pending - done - failed} omitidos
            {running && " — no cierres esta página hasta que termine."}
          </p>
        )}
      </div>
    </form>
  );
}
