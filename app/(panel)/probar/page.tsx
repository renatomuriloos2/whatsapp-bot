import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { getAllCompanies } from "@/lib/data";
import { TestBotChat } from "@/components/whatsapp/TestBotChat";

export default async function ProbarBotPage() {
  await requireAppUser("admin");
  const companies = await getAllCompanies(await createClient());

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-rethink-cream">Probar el bot</h1>
      <p className="mb-6 text-sm text-rethink-cream/60">
        Conversa con el asistente sin usar WhatsApp para revisar sus respuestas antes de que las
        vean los clientes. Cambia el nivel de acceso para confirmar que la información reservada
        no se filtra. El costo de las pruebas se suma al presupuesto del mes.
      </p>
      <TestBotChat companies={companies} />
    </div>
  );
}
