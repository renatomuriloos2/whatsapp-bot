import "server-only";

// Cliente mínimo de Microsoft Graph con credenciales de aplicación
// (client credentials). Requiere una app registrada en Microsoft Entra ID
// con permisos de aplicación Files.Read.All y Sites.Read.All aprobados por
// un administrador. Ver README → "Sincronizar con OneDrive".

const GRAPH = "https://graph.microsoft.com/v1.0";

export function onedriveConfigured(): boolean {
  return Boolean(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  if (!onedriveConfigured()) {
    throw new Error("OneDrive no está configurado: faltan MS_TENANT_ID, MS_CLIENT_ID o MS_CLIENT_SECRET en Vercel.");
  }
  const res = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID!,
      client_secret: process.env.MS_CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`Microsoft rechazó las credenciales: ${json.error_description ?? res.status}`);
  }
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

async function graphGet<T>(pathOrUrl: string): Promise<T> {
  const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}` } });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403) {
      throw new Error(
        "Microsoft negó el acceso (403). Revisa que la app tenga los permisos de aplicación Files.Read.All y Sites.Read.All con consentimiento de administrador."
      );
    }
    if (res.status === 404) throw new Error("No se encontró la carpeta o el archivo en OneDrive (404).");
    throw new Error(`Microsoft Graph ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export interface DriveItem {
  id: string;
  name: string;
  webUrl?: string;
  size?: number;
  cTag?: string;
  eTag?: string;
  folder?: { childCount: number };
  file?: { mimeType?: string };
  parentReference?: { driveId: string; id?: string };
}

/**
 * Convierte el enlace que la persona copia en OneDrive en la carpeta real.
 * Acepta enlaces de "Compartir → Copiar vínculo" y también la dirección
 * del navegador (…/onedrive.aspx?id=/personal/…/Documents/Carpeta).
 */
export async function resolveFolderUrl(input: string): Promise<{
  driveId: string;
  itemId: string;
  name: string;
  webUrl: string | null;
}> {
  let url = input.trim();
  try {
    const parsed = new URL(url);
    const idParam = parsed.searchParams.get("id");
    if (parsed.pathname.endsWith("/onedrive.aspx") && idParam) {
      url = `${parsed.origin}${idParam}`;
    }
  } catch {
    throw new Error("El enlace no es válido. Copia el vínculo de la carpeta desde OneDrive.");
  }

  const shareId = "u!" + Buffer.from(url, "utf8").toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  const item = await graphGet<DriveItem>(`/shares/${shareId}/driveItem`);
  if (!item.folder) throw new Error("El enlace apunta a un archivo, no a una carpeta.");
  const driveId = item.parentReference?.driveId;
  if (!driveId) throw new Error("No se pudo identificar la unidad de OneDrive de esa carpeta.");
  return { driveId, itemId: item.id, name: item.name, webUrl: item.webUrl ?? null };
}

/** Lista todos los archivos de la carpeta y sus subcarpetas (con la ruta relativa). */
export async function listFilesRecursive(
  driveId: string,
  folderId: string,
  maxFiles = 3000
): Promise<{ item: DriveItem; folderPath: string[] }[]> {
  const out: { item: DriveItem; folderPath: string[] }[] = [];
  const queue: { id: string; path: string[] }[] = [{ id: folderId, path: [] }];

  while (queue.length > 0) {
    const { id, path } = queue.shift()!;
    let next: string | undefined =
      `/drives/${driveId}/items/${id}/children?$top=200&$select=id,name,size,cTag,eTag,webUrl,folder,file`;
    while (next) {
      const page: { value: DriveItem[]; "@odata.nextLink"?: string } = await graphGet(next);
      for (const child of page.value) {
        if (child.folder) {
          if (path.length < 10) queue.push({ id: child.id, path: [...path, child.name] });
        } else if (child.file) {
          out.push({ item: child, folderPath: path });
          if (out.length >= maxFiles) return out;
        }
      }
      next = page["@odata.nextLink"];
    }
  }
  return out;
}

export async function downloadFile(driveId: string, itemId: string): Promise<ArrayBuffer> {
  const res = await fetch(`${GRAPH}/drives/${driveId}/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${await getToken()}` },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`No se pudo descargar el archivo (${res.status}).`);
  return res.arrayBuffer();
}
