// Pruebas básicas de piezas críticas. Ejecutar con: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.WHATSAPP_APP_SECRET = "secreto-de-prueba";

test("webhook: acepta solo firmas HMAC válidas de Meta", async () => {
  const { verifySignature } = await import("../lib/whatsapp/cloud-api");
  const body = JSON.stringify({ object: "whatsapp_business_account" });
  const good = "sha256=" + crypto.createHmac("sha256", "secreto-de-prueba").update(body).digest("hex");
  assert.equal(verifySignature(body, good), true);
  assert.equal(verifySignature(body + " ", good), false, "cuerpo alterado");
  assert.equal(verifySignature(body, "sha256=" + "0".repeat(64)), false, "firma falsa");
  assert.equal(verifySignature(body, null), false, "sin firma");
});

test("fragmentos: nunca cortan un enlace", async () => {
  const { chunkText } = await import("../lib/knowledge");
  const url = "https://forms.office.com/Pages/ResponsePage.aspx?id=" + "x".repeat(120);
  const text = Array.from({ length: 60 }, (_, i) => `Formulario ${i}: ${url}`).join("\n");
  for (const chunk of chunkText(text)) {
    for (const m of chunk.match(/https?:\/\/\S+/g) ?? []) assert.equal(m, url);
  }
});

test("enlaces: la búsqueda encuentra el formulario por sinónimos y respeta la empresa", async () => {
  const { findLinks } = await import("../lib/knowledge/links");
  const content = [
    "## Portal SGI",
    "### FORMULARIOS DE REGISTROS",
    "- Solicitud de Muestras (Formulario): https://form.jotform.com/1",
    "- Envío de Muestra (Formulario): https://form.jotform.com/2",
    "- Entrega de EPP (Formulario): https://forms.office.com/r/3",
  ].join("\n");
  const docs = [
    { title: "SGI", content, company_id: null },
    { title: "Otra empresa", content: "- Envío de muestra secreto: https://otra.example/x", company_id: "empresa-b" },
  ];
  const fake = {
    from: () => ({ select: () => ({ eq: () => ({ in: () => ({ ilike: () => ({ limit: async () => ({ data: docs, error: null }) }) }) }) }) }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const found = await findLinks(fake as any, "formulario cuando un proveedor quiere enviar una muestra", "confidencial", "empresa-a", true, 3);
  assert.match(found[0], /Envío de Muestra/);
  assert.ok(!found.some((l) => l.includes("otra.example")), "no muestra enlaces de otra empresa");
});

test("enlaces: las listas del SGI solo se muestran al personal interno", async () => {
  const { findLinks } = await import("../lib/knowledge/links");
  const docs = [
    { title: "SGI - Enlaces del Portal SGI", category: "SGI - Enlaces", content: "- Entrega de EPP (Formulario): https://forms.office.com/r/3", company_id: null },
  ];
  const fake = {
    from: () => ({ select: () => ({ eq: () => ({ in: () => ({ ilike: () => ({ limit: async () => ({ data: docs, error: null }) }) }) }) }) }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal((await findLinks(fake as any, "entrega de EPP", "cliente", null, false)).length, 0);
  // Cliente externo con nivel Confidencial: no ve el SGI.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal((await findLinks(fake as any, "entrega de EPP", "confidencial", "empresa-a", false)).length, 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal((await findLinks(fake as any, "entrega de EPP", "confidencial", null, true)).length, 1);
});

test("archivos: un cliente externo Confidencial no recibe archivos del SGI ni de otra empresa", async () => {
  const { findSendableDocument } = await import("../lib/documents/files");
  const id = "11111111-2222-3333-4444-555555555555";
  const row = (extra: object) => ({
    id,
    title: "SGI - Procedimiento de compras",
    file_name: "PR-COM-01.pdf",
    category: "SGI",
    storage_path: `${id}/PR-COM-01.pdf`,
    external_id: null,
    access_level: "confidencial",
    company_id: null,
    active: true,
    kb_sources: null,
    ...extra,
  });
  const fake = (doc: object) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: doc }) }) }) }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(await findSendableDocument(fake(row({})) as any, id, "confidencial", "empresa-a", false), null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.ok(await findSendableDocument(fake(row({})) as any, id, "confidencial", null, true));
  const other = row({ title: "Ficha técnica X", category: "TDS", company_id: "empresa-b" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(await findSendableDocument(fake(other) as any, id, "confidencial", "empresa-a", true), null);
});
