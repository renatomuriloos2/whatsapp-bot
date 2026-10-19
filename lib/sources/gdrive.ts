import "server-only";
import crypto from "node:crypto";
import type { RemoteFile } from "@/lib/sources/types";

// Google Drive con una cuenta de servicio: la cuenta solo ve las carpetas que
// se compartan con su correo (…@….iam.gserviceaccount.com), igual que con
// una persona. Ver README → "Sincronizar con Google Drive".

const DRIVE = "https://www.googleapis.com/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";

// Documentos nativos de Google: se exportan a texto para poder leerlos.
const EXPORTS: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "text/plain", ext: ".txt" },
  // Excel (no CSV) para leer todas las hojas, no solo la primera.
  "application/vnd.google-apps.spreadsheet": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: ".xlsx",
  },
  "application/vnd.google-apps.presentation": { mime: "text/plain", ext: ".txt" },
};

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    return parsed.client_email && parsed.private_key ? parsed : null;
  } catch {
    return null;
  }
}

export function gdriveConfigured(): boolean {
  return serviceAccount() !== null;
}

/** Correo de la cuenta de servicio: con él se comparten las carpetas. */
export function gdriveServiceEmail(): string | null {
  return serviceAccount()?.client_email ?? null;
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const sa = serviceAccount();
  if (!sa) {
    throw new Error(
      "Google Drive no está configurado: falta GOOGLE_SERVICE_ACCOUNT_JSON en Vercel (o el JSON está incompleto)."
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signature = b64url(
    crypto.createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.private_key.replace(/\\n/g, "\n"))
  );

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`Google rechazó la cuenta de servicio: ${json.error_description ?? res.status}`);
  }
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

async function driveFetch(path: string): Promise<Response> {
  const res = await fetch(`${DRIVE}${path}`, { headers: { Authorization: `Bearer ${await getToken()}` } });
  if (!res.ok) {
    if (res.status === 404 || res.status === 403) {
      throw new Error(
        `Google Drive no deja ver esa carpeta (${res.status}). Compártela con ${gdriveServiceEmail()} como Lector.`
      );
    }
    throw new Error(`Google Drive ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  version?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

/** Extrae el ID de carpeta de un enlace de Google Drive. */
export function parseFolderId(input: string): string | null {
  const text = input.trim();
  const fromPath = text.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (fromPath) return fromPath[1];
  try {
    const id = new URL(text).searchParams.get("id");
    if (id) return id;
  } catch {
    // no es una URL: quizá pegaron solo el ID
  }
  return /^[a-zA-Z0-9_-]{10,}$/.test(text) ? text : null;
}

export async function resolveGdriveFolder(input: string) {
  const id = parseFolderId(input);
  if (!id) throw new Error("No reconozco ese enlace. Copia el vínculo de la carpeta desde Google Drive.");
  const res = await driveFetch(`/files/${id}?fields=id,name,mimeType,webViewLink&supportsAllDrives=true`);
  const file = (await res.json()) as DriveFile;
  if (file.mimeType !== FOLDER) throw new Error("El enlace apunta a un archivo, no a una carpeta.");
  return { driveId: "gdrive", itemId: file.id, name: file.name, webUrl: file.webViewLink ?? null };
}

export async function listGdriveFiles(folderId: string, maxFiles = 3000): Promise<RemoteFile[]> {
  const out: RemoteFile[] = [];
  const queue: { id: string; path: string[] }[] = [{ id: folderId, path: [] }];
  const fields = "nextPageToken,files(id,name,mimeType,size,version,md5Checksum,modifiedTime,webViewLink)";

  while (queue.length > 0) {
    const { id, path } = queue.shift()!;
    let pageToken: string | undefined;
    do {
      const q = encodeURIComponent(`'${id}' in parents and trashed = false`);
      const res = await driveFetch(
        `/files?q=${q}&fields=${encodeURIComponent(fields)}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true` +
          (pageToken ? `&pageToken=${pageToken}` : "")
      );
      const page = (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
      for (const f of page.files) {
        if (f.mimeType === FOLDER) {
          if (path.length < 10) queue.push({ id: f.id, path: [...path, f.name] });
          continue;
        }
        const exported = EXPORTS[f.mimeType];
        if (f.mimeType.startsWith("application/vnd.google-apps.") && !exported) continue; // formularios, mapas…
        out.push({
          id: f.id,
          name: exported ? `${f.name}${exported.ext}` : f.name,
          // md5 cambia con el contenido; los nativos de Google no tienen md5.
          version: f.md5Checksum ?? `${f.version ?? ""}-${f.modifiedTime ?? ""}`,
          size: f.size ? Number(f.size) : 0,
          webUrl: f.webViewLink ?? null,
          folderPath: path,
          mimeType: f.mimeType,
        });
        if (out.length >= maxFiles) return out;
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  return out;
}

export async function downloadGdriveFile(file: RemoteFile): Promise<ArrayBuffer> {
  const exported = file.mimeType ? EXPORTS[file.mimeType] : undefined;
  const res = exported
    ? await driveFetch(`/files/${file.id}/export?mimeType=${encodeURIComponent(exported.mime)}`)
    : await driveFetch(`/files/${file.id}?alt=media&supportsAllDrives=true`);
  return res.arrayBuffer();
}

// Al enviar un documento de Google (Docs, Hojas, Presentaciones) por
// WhatsApp se exporta en un formato que la persona pueda abrir en el celular.
const SEND_EXPORTS: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "application/pdf", ext: ".pdf" },
  "application/vnd.google-apps.presentation": { mime: "application/pdf", ext: ".pdf" },
  "application/vnd.google-apps.spreadsheet": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: ".xlsx",
  },
};

/** El archivo original (no el texto) para enviarlo tal cual por WhatsApp. */
export async function downloadGdriveOriginal(
  fileId: string
): Promise<{ data: ArrayBuffer; fileName: string; mimeType: string }> {
  const meta = (await (
    await driveFetch(`/files/${fileId}?fields=name,mimeType&supportsAllDrives=true`)
  ).json()) as { name: string; mimeType: string };
  const exported = SEND_EXPORTS[meta.mimeType];
  if (exported) {
    const res = await driveFetch(`/files/${fileId}/export?mimeType=${encodeURIComponent(exported.mime)}`);
    return { data: await res.arrayBuffer(), fileName: `${meta.name}${exported.ext}`, mimeType: exported.mime };
  }
  const res = await driveFetch(`/files/${fileId}?alt=media&supportsAllDrives=true`);
  return { data: await res.arrayBuffer(), fileName: meta.name, mimeType: meta.mimeType };
}
