"use client";

import { useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { testNotificationAction, updateSettingsAction } from "@/lib/actions/whatsapp";
import { ActionState } from "@/lib/action-state";
import { BotSettings } from "@/types/database";
import { BOT_MODELS, EFFORT_OPTIONS } from "@/lib/ai/models";

const initialState: ActionState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Guardando..." : "Guardar configuración"}
    </button>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="card flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium text-rethink-cream">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-rethink-cream/50">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function TestNotificationButton() {
  const [result, setResult] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={sending}
        className="btn-secondary"
        onClick={async (e) => {
          const form = e.currentTarget.form;
          const value = (name: string) => String(form ? new FormData(form).get(name) ?? "" : "");
          setSending(true);
          setResult(null);
          try {
            setResult(
              await testNotificationAction({
                phone: value("alert_phone"),
                email: value("alert_email"),
                template: value("alert_template"),
              })
            );
          } catch {
            setResult("No se pudo enviar.");
          }
          setSending(false);
        }}
      >
        {sending ? "Enviando…" : "Enviar aviso de prueba"}
      </button>
      {result && <p className="text-xs text-rethink-cream/70">{result}</p>}
    </div>
  );
}

export function SettingsForm({ settings }: { settings: BotSettings }) {
  const [state, formAction] = useFormState(updateSettingsAction, initialState);
  const submitted = useRef(false);

  return (
    <form
      action={(fd) => {
        submitted.current = true;
        formAction(fd);
      }}
      className="grid grid-cols-1 gap-6 lg:grid-cols-2"
    >
      <Section title="Estado y modelo">
        <label className="flex items-center gap-2 text-sm text-rethink-cream/80">
          <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="accent-rethink-orange" />
          Bot activo (si lo apagas, los mensajes se guardan pero nadie responde automáticamente)
        </label>
        <div>
          <label className="label" htmlFor="model">
            Modelo de IA
          </label>
          <select id="model" name="model" defaultValue={settings.model} className="input">
            {BOT_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.hint}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="effort">
            Esfuerzo de razonamiento
          </label>
          <select id="effort" name="effort" defaultValue={settings.effort} className="input">
            {EFFORT_OPTIONS.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label} — {e.hint}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="history_messages">
            Mensajes previos que recuerda el bot
          </label>
          <input
            id="history_messages"
            name="history_messages"
            type="number"
            min={0}
            max={50}
            defaultValue={settings.history_messages}
            className="input"
          />
        </div>
      </Section>

      <Section
        title="Costos y límites"
        hint="Al llegar al presupuesto del mes, el bot deja de usar IA y envía el mensaje de abajo."
      >
        <div>
          <label className="label" htmlFor="monthly_budget_usd">
            Presupuesto mensual (USD)
          </label>
          <input
            id="monthly_budget_usd"
            name="monthly_budget_usd"
            type="number"
            min={0}
            step="0.01"
            defaultValue={settings.monthly_budget_usd}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="daily_limit_per_contact">
            Máximo de respuestas del bot por contacto al día
          </label>
          <input
            id="daily_limit_per_contact"
            name="daily_limit_per_contact"
            type="number"
            min={1}
            defaultValue={settings.daily_limit_per_contact}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="budget_exceeded_message">
            Mensaje cuando se agota el presupuesto
          </label>
          <textarea
            id="budget_exceeded_message"
            name="budget_exceeded_message"
            rows={2}
            defaultValue={settings.budget_exceeded_message}
            className="input"
          />
        </div>
      </Section>

      <Section
        title="Personalidad y conocimiento general"
        hint="Describe la empresa, el tono y reglas propias. Los datos técnicos van en la Base de conocimiento, no aquí."
      >
        <div>
          <label className="label" htmlFor="company_name">
            Nombre de la empresa
          </label>
          <input id="company_name" name="company_name" defaultValue={settings.company_name} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="instructions">
            Instrucciones para el asistente
          </label>
          <textarea
            id="instructions"
            name="instructions"
            rows={8}
            defaultValue={settings.instructions}
            className="input"
          />
        </div>
      </Section>

      <Section title="Contactos nuevos y derivación a humanos">
        <div>
          <label className="label" htmlFor="unknown_contacts">
            Cuando escribe un número que no está registrado
          </label>
          <select id="unknown_contacts" name="unknown_contacts" defaultValue={settings.unknown_contacts} className="input">
            <option value="publico">Responderle con información pública</option>
            <option value="pendiente">Dejarlo pendiente hasta que alguien lo apruebe</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="pending_message">
            Mensaje para números pendientes
          </label>
          <textarea id="pending_message" name="pending_message" rows={2} defaultValue={settings.pending_message} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="handoff_message">
            Mensaje cuando el bot no puede responder
          </label>
          <textarea id="handoff_message" name="handoff_message" rows={2} defaultValue={settings.handoff_message} className="input" />
        </div>
      </Section>

      <Section
        title="Avisos al equipo"
        hint="Te avisamos cuando alguien pide acceso de Cliente o Confidencial, cuando el bot deriva a un asesor o cuando escribe un número nuevo pendiente de aprobación."
      >
        <div>
          <label className="label" htmlFor="alert_phone">
            WhatsApp que recibe los avisos (con código de país)
          </label>
          <input
            id="alert_phone"
            name="alert_phone"
            inputMode="tel"
            placeholder="50499998888"
            defaultValue={settings.alert_phone ?? ""}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="alert_template">
            Nombre de la plantilla de WhatsApp aprobada (recomendado)
          </label>
          <input
            id="alert_template"
            name="alert_template"
            placeholder="aviso_pendiente"
            defaultValue={settings.alert_template ?? ""}
            className="input"
          />
          <p className="mt-1 text-xs text-rethink-cream/50">
            Sin plantilla, WhatsApp solo entrega el aviso si ese número le escribió al bot en las últimas 24 horas.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="alert_email">
            Correo que recibe los avisos (puedes poner varios separados por coma)
          </label>
          <input
            id="alert_email"
            name="alert_email"
            type="text"
            placeholder="renato@rethink.hn"
            defaultValue={settings.alert_email ?? ""}
            className="input"
          />
          <p className="mt-1 text-xs text-rethink-cream/50">Requiere RESEND_API_KEY en Vercel.</p>
        </div>
        <TestNotificationButton />
        <p className="text-xs text-rethink-cream/50">
          La prueba usa lo que está escrito arriba. Recuerda tocar &quot;Guardar configuración&quot; para que el bot lo use.
        </p>
      </Section>

      <div className="flex items-center gap-4 lg:col-span-2">
        <SubmitButton />
        {state.error && <p className="text-sm text-red-400">{state.error}</p>}
        {submitted.current && state.error === null && (
          <p className="text-sm text-rethink-green">Configuración guardada.</p>
        )}
      </div>
    </form>
  );
}
