// Tipos de las tablas de supabase/schema.sql.

export type Role = "admin" | "agente";

export interface AppUser {
  id: string;
  email: string;
  role: Role;
}

export interface Company {
  id: string;
  name: string;
  notes: string | null;
  /** Empresa propia (Rethink): sus contactos cuentan como personal interno (migración 011). */
  interna?: boolean;
  created_at: string;
}

export type AccessLevel = "publico" | "cliente" | "confidencial";

export type ContactStatus = "activo" | "pendiente" | "bloqueado";

export type Effort = "low" | "medium" | "high";

export interface KbDocument {
  id: string;
  title: string;
  category: string | null;
  description: string | null;
  access_level: AccessLevel;
  company_id: string | null;
  file_name: string | null;
  storage_path?: string | null;
  content: string;
  active: boolean;
  chunk_count: number;
  has_embeddings: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WaContact {
  id: string;
  phone: string;
  profile_name: string | null;
  display_name: string | null;
  access_level: AccessLevel;
  status: ContactStatus;
  company_id: string | null;
  notes: string | null;
  bot_paused: boolean;
  needs_attention: boolean;
  attention_reason: string | null;
  last_inbound_at: string | null;
  /** Desde cuándo la IA ve el historial (se fija al bajar el nivel de acceso). */
  history_reset_at?: string | null;
  /** Personal interno de la empresa: único que puede recibir documentos del SGI (migración 010). */
  interno?: boolean;
  last_message_at: string | null;
  created_at: string;
}

export interface WaMessage {
  id: string;
  contact_id: string;
  direction: "in" | "out";
  sender: "cliente" | "bot" | "agente" | "sistema";
  body: string;
  message_type: string;
  wa_message_id: string | null;
  status: string | null;
  agent_id: string | null;
  created_at: string;
}

export interface AiUsage {
  id: string;
  contact_id: string | null;
  source: "whatsapp" | "prueba";
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  api_calls: number;
  tool_calls: number;
  latency_ms: number | null;
  stop_reason: string | null;
  created_at: string;
}

export interface BotSettings {
  id: number;
  enabled: boolean;
  model: string;
  effort: Effort;
  company_name: string;
  instructions: string;
  unknown_contacts: "publico" | "pendiente";
  pending_message: string;
  handoff_message: string;
  monthly_budget_usd: number;
  budget_exceeded_message: string;
  daily_limit_per_contact: number;
  history_messages: number;
  /** WhatsApp (con código de país) y correo que reciben los avisos de pendientes. */
  alert_phone?: string | null;
  alert_email?: string | null;
  /** Plantilla aprobada en Meta para avisar por WhatsApp fuera de la ventana de 24 h. */
  alert_template?: string | null;
  updated_at: string;
}
