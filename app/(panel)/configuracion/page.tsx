import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { getBotSettings } from "@/lib/whatsapp/bot";
import { SettingsForm } from "@/components/whatsapp/SettingsForm";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ConfiguracionBotPage() {
  await requireAppUser("admin");
  const settings = await getBotSettings(createClient());

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-rethink-cream">Configuración del bot</h1>
      <p className="mb-6 text-sm text-rethink-cream/60">
        Última modificación: {formatDate(settings.updated_at)}. Los cambios aplican desde el
        siguiente mensaje que llegue.
      </p>
      <SettingsForm settings={settings} />
    </div>
  );
}
