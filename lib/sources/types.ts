import type { AccessLevel } from "@/types/database";

export type SourceProvider = "gdrive" | "onedrive" | "web";

export interface KbSource {
  id: string;
  provider: SourceProvider;
  name: string;
  drive_id: string;
  item_id: string;
  access_level: AccessLevel;
  company_id: string | null;
  category: string | null;
  enabled: boolean;
}

/** Un archivo de la carpeta remota, igual para Google Drive y OneDrive. */
export interface RemoteFile {
  id: string;
  name: string;
  /** Cambia cuando cambia el contenido; si es igual, no se vuelve a leer. */
  version: string;
  size: number;
  webUrl: string | null;
  /** Subcarpetas desde la carpeta conectada hasta el archivo. */
  folderPath: string[];
  mimeType?: string;
}
