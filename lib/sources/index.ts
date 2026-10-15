import "server-only";
import { downloadFile, listFilesRecursive, onedriveConfigured, resolveFolderUrl } from "@/lib/onedrive/graph";
import { downloadGdriveFile, gdriveConfigured, listGdriveFiles, resolveGdriveFolder } from "@/lib/sources/gdrive";
import { downloadWebPage, listWebPages, resolveWebsite } from "@/lib/sources/web";
import type { KbSource, RemoteFile, SourceProvider } from "@/lib/sources/types";

export function detectProvider(url: string): SourceProvider | null {
  if (/drive\.google\.com|docs\.google\.com/i.test(url)) return "gdrive";
  if (/sharepoint\.com|onedrive\.live\.com|1drv\.ms/i.test(url)) return "onedrive";
  if (/^https?:\/\//i.test(url.trim())) return "web";
  return null;
}

export function providerConfigured(provider: SourceProvider): boolean {
  if (provider === "web") return true;
  return provider === "gdrive" ? gdriveConfigured() : onedriveConfigured();
}

export async function resolveFolder(provider: SourceProvider, url: string) {
  if (provider === "web") return resolveWebsite(url);
  return provider === "gdrive" ? resolveGdriveFolder(url) : resolveFolderUrl(url);
}

export async function listFiles(source: KbSource): Promise<RemoteFile[]> {
  if (source.provider === "web") return listWebPages(source.item_id);
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
  if (source.provider === "web") return downloadWebPage(file);
  return source.provider === "gdrive" ? downloadGdriveFile(file) : downloadFile(source.drive_id, file.id);
}
