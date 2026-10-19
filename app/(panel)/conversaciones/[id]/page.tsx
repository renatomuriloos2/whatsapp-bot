import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { getAllCompanies } from "@/lib/data";
import { ContactForm } from "@/components/whatsapp/ContactForm";
import { AgentReplyForm } from "@/components/whatsapp/AgentReplyForm";
import { ChatBubble } from "@/components/whatsapp/ChatBubble";
import { AccessLevelBadge, ContactStatusBadge } from "@/components/whatsapp/Badges";
import { deleteContactAction, resolveAttentionAction, setBotPausedAction } from "@/lib/actions/whatsapp";
import { formatUsd } from "@/lib/ai/models";
import { WaContact, WaMessage } from "@/types/database";

export const dynamic = "force-dynamic";
// Al aprobar un registro el bot responde con IA (puede tardar unos segundos).
export const maxDuration = 60;

const SENDER_LABEL: Record<WaMessage["sender"], string> = {
  cliente: "",
  bot: "🤖 Bot",
  agente: "👤 Asesor",
  sistema: "⚙️ Automático",
};

const STATUS_LABEL: Record<string, string> = {
  sent: "enviado",
  delivered: "entregado",
  read: "leído",
  failed: "falló",
};

function formatTime(value: string) {
  return new Date(value).toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function ContactDetailPage({ params }: { params: { id: string } }) {
  const appUser = await requireAppUser();
  const supabase = createClient();

  const [{ data: contactData }, { data: messagesData }, companies, usage] = await Promise.all([
    supabase.from("wa_contacts").select("*").eq("id", params.id).single(),
    supabase
      .from("wa_messages")
      .select("*")
      .eq("contact_id", params.id)
      .order("created_at", { ascending: false })
      .limit(200),
    getAllCompanies(supabase),
    appUser.role === "admin"
      ? supabase.from("ai_usage").select("cost_usd").eq("contact_id", params.id)
      : Promise.resolve({ data: null }),
  ]);
  if (!contactData) notFound();

  const contact = contactData as WaContact;
  const messages = ((messagesData ?? []) as WaMessage[]).reverse();
  const totalCost = (usage.data ?? []).reduce((s: number, r: { cost_usd: number }) => s + Number(r.cost_usd), 0);
  const windowOpen =
    contact.last_inbound_at !== null &&
    Date.now() - new Date(contact.last_inbound_at).getTime() < 24 * 60 * 60 * 1000;

  return (
    <div>
      <Link href="/conversaciones" className="text-xs text-rethink-orange hover:underline">
        ← Contactos
      </Link>
      <div className="mb-6 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-rethink-cream">
          {contact.display_name ?? contact.profile_name ?? `+${contact.phone}`}
        </h1>
        <AccessLevelBadge level={contact.access_level} />
        <ContactStatusBadge status={contact.status} />
        <span className="text-sm text-rethink-cream/50">+{contact.phone}</span>
        {usage.data && (
          <span className="text-sm text-rethink-cream/50">· IA: {formatUsd(totalCost, 4)}</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          {contact.needs_attention && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rethink-amber/30 bg-rethink-amber/10 px-4 py-3">
              <p className="text-sm text-rethink-amber">⚠ {contact.attention_reason ?? "Requiere atención."}</p>
              <form action={resolveAttentionAction}>
                <input type="hidden" name="id" value={contact.id} />
                <button type="submit" className="btn-secondary text-xs">
                  Marcar como resuelto
                </button>
              </form>
            </div>
          )}

          <div className="card flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-rethink-cream/70">
                {contact.bot_paused
                  ? "👤 Un asesor tiene el control: el bot no responde en este chat."
                  : "🤖 El bot responde automáticamente."}
              </p>
              <form action={setBotPausedAction}>
                <input type="hidden" name="id" value={contact.id} />
                <input type="hidden" name="paused" value={String(!contact.bot_paused)} />
                <button type="submit" className={contact.bot_paused ? "btn-primary" : "btn-secondary"}>
                  {contact.bot_paused ? "Devolver al bot" : "Tomar el control"}
                </button>
              </form>
            </div>

            <div className="flex max-h-[60vh] min-h-[240px] flex-col gap-2 overflow-y-auto rounded-lg bg-black/10 p-3">
              {messages.length === 0 ? (
                <p className="m-auto text-sm text-rethink-cream/50">Sin mensajes todavía.</p>
              ) : (
                messages.map((m) => (
                  <ChatBubble
                    key={m.id}
                    outgoing={m.direction === "out"}
                    author={SENDER_LABEL[m.sender] || undefined}
                    time={formatTime(m.created_at)}
                    status={m.direction === "out" && m.status ? STATUS_LABEL[m.status] ?? m.status : null}
                  >
                    {m.body}
                  </ChatBubble>
                ))
              )}
            </div>

            <AgentReplyForm contactId={contact.id} windowOpen={windowOpen} />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="card">
            <h3 className="mb-4 text-sm font-medium text-rethink-cream">Acceso del contacto</h3>
            <ContactForm companies={companies} contact={contact} />
          </div>
          <form action={deleteContactAction} className="px-1">
            <input type="hidden" name="id" value={contact.id} />
            <button type="submit" className="text-xs text-red-400 hover:underline">
              Eliminar contacto e historial
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
