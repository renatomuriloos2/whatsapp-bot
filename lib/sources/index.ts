import "server-only";
import { downloadFile, listFilesRecursive, onedriveConfigured, resolveFolderUrl } from "@/lib/onedrive/graph";
import { downloadGdriveFile, gdriveConfigured, listGdriveFiles, resolveGdriveFolder } from "@/lib/sources/gdrive";
import type { KbSource, RemoteFile, SourceProvider } from "@/lib/sources/types";

export function detectProvider(url: string): SourceProvider | null {
  if (/drive\.google\.com|docs\.google\.com/i.test(url)) return "gdrive";
  if (/sharepoint\.com|onedrive\.live\.com|1drv\.ms/i.test(url)) return "onedrive";
  return null;
}

export function providerConfigured(provider: SourceProvider): boolean {
  return provider === "gdrive" ? gdriveConfigured() : onedriveConfigured();
}

export async function resolveFolder(provider: SourceProvider, url: string) {
  return provider === "gdrive" ? resolveGdriveFolder(url) : resolveFolderUrl(url);
}

export async function listFiles(source: KbSource): Promise<RemoteFile[]> {
  if (source.provider === "gdrive") return listGdriveFiles(source.item_id);
  const items = await listFilesRecursive(source.drive_id, source.item_id);
  return items.map(({ item, folderPath }) => ({
    id: item.id,
    name: item.name,
    version: item.cTag ?? item.eTag ?? "",
    size: item.size ?? 0,
    webUrl: item.webUrl ?? null,
    folderPath,
  }));
}

export async function downloadRemoteFile(source: KbSource, file: RemoteFile): Promise<ArrayBuffer> {
  return source.provider === "gdrive" ? downloadGdriveFile(file) : downloadFile(source.drive_id, file.id);
}
