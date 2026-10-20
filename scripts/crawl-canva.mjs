// Rastrea el Portal SGI (sitios de Canva) con un navegador completo y
// actualiza el documento "SGI - Enlaces del Portal SGI" del bot.
//
// Lo ejecuta GitHub Actions todos los días (.github/workflows/sync-portal-sgi.yml)
// porque Vercel no tiene memoria suficiente para abrir el navegador.
//
// Variables de entorno:
//   CANVA_START_URLS  Sitios a recorrer, separados por coma (por defecto el Portal SGI).
//   CHROME_PATH       Navegador (en GitHub: /usr/bin/google-chrome).
//   PORTAL_URL        Dirección del portal (ej. https://whatsapp-bot-eight-brown.vercel.app).
//   CRON_SECRET       Misma clave que en Vercel.
//   DRY_RUN=1         Solo imprime el resultado, no lo envía.
import puppeteer from "puppeteer-core";

const START = (process.env.CANVA_START_URLS || "https://sgi-rethink.my.canva.site/sgi")
  .split(",").map((s) => s.trim()).filter(Boolean);
const MAX_SITES = 40;

const COLLECT = `(() => {
  const clean = (t) => (t || "").replace(/\\s+/g, " ").trim();
  const H = innerHeight;
  const vis = (r) => r.width > 0 && r.height > 0 && r.top >= -5 && r.top < H && r.left < innerWidth && r.right > 0;
  const generic = /^(da|click|clic|da click|da clic|inicio|aqu[ií]|ver|-|i|d)$/i;
  const texts = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,span,li,div"))
    .filter((el) => { const t = clean(el.innerText); if (!t || t.length > 150) return false;
      return !Array.from(el.children).some((c) => clean(c.innerText) === t); })
    .map((el) => ({ text: clean(el.innerText), r: el.getBoundingClientRect(), size: parseFloat(getComputedStyle(el).fontSize) || 0 }))
    .filter((t) => vis(t.r) && !generic.test(t.text) && !/^(Terms|Designed with)/i.test(t.text));
  const heading = texts.slice().sort((a, b) => b.size - a.size)[0];
  const links = Array.from(document.querySelectorAll("a[href]")).filter((a) => /^https?:/.test(a.href)).map((a) => {
    const r = a.getBoundingClientRect();
    if (!vis(r)) return null;
    const own = clean(a.innerText) || clean(a.getAttribute("aria-label")) || clean(a.title);
    const cands = texts.filter((t) => t !== heading && t.text.length <= 120).map((t) => {
      const dx = Math.max(0, r.left - t.r.right, t.r.left - r.right);
      const dy = Math.max(0, r.top - t.r.bottom, t.r.top - r.bottom);
      return { text: t.text, d: dx + dy + (t.r.bottom <= r.top + 4 ? 0 : 40) };
    }).sort((x, y) => x.d - y.d).slice(0, 3);
    return { href: a.href, own: generic.test(own) ? "" : own, cands };
  }).filter(Boolean);
  return { links, heading: heading ? heading.text : "", title: document.title };
})()`;

function tipo(u) {
  if (/jotform|forms\.office|forms\.cloud/.test(u)) return /DesignPage/.test(u) ? "Formulario – edición" : /AnalysisPage/.test(u) ? "Resultados de formulario" : "Formulario";
  if (u.includes("powerbi")) return "Indicadores Power BI";
  if (u.includes("tasks.office")) return "Plan en Planner";
  if (u.includes("canva.link")) return "Presentación";
  for (const [p, t] of [["/:x:/", "Excel"], ["/:w:/", "Word"], ["/:b:/", "PDF"], ["/:f:/", "Carpeta"], ["/:l:/", "Lista SharePoint"]]) if (u.includes(p)) return t;
  if (/AllItems|\/Forms\//.test(u)) return "Carpeta SharePoint";
  if (/\.xlsx/i.test(u)) return "Excel";
  return "Documento";
}

/** Mejor nombre para un enlace a partir de todas las veces que apareció. */
function bestLabel(occ) {
  const options = [];
  for (const o of occ) {
    const near = o.cands.find((c) => c.d < 300);
    // Texto propio cortado ("Matriz de Partes") → el texto cercano que lo contiene.
    if (o.own && o.own.length >= 4) {
      const fuller = o.cands.find((c) => c.d < 120 && c.text.toLowerCase().includes(o.own.toLowerCase()) && c.text.length > o.own.length);
      options.push({ text: fuller ? fuller.text : o.own, score: 0 });
    } else if (near) options.push({ text: near.text, score: near.d + 1 });
  }
  options.sort((a, b) => a.score - b.score || b.text.length - a.text.length);
  return options[0]?.text || "";
}

async function crawl() {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : [])],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const queue = [...START];
  const seen = new Set();
  const sites = [];
  const failed = [];
  while (queue.length && sites.length < MAX_SITES) {
    const url = queue.shift().replace(/#.*$/, "").replace(/\/$/, "").replace(/^http:/, "https:");
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    } catch (e) {
      failed.push(url);
      continue;
    }
    await new Promise((r) => setTimeout(r, 1500));
    const hashes = await page.evaluate(`Array.from(new Set(Array.from(document.querySelectorAll("a[href*='#page']")).map(a => "#" + a.getAttribute("href").split("#")[1])))`);
    const site = { url, title: await page.title(), sections: new Map() };
    for (const h of ["", ...hashes]) {
      if (h) {
        await page.goto(url + "/" + h, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 1000));
      }
      const res = await page.evaluate(COLLECT);
      for (const l of res.links) {
        if (/\.my\.canva\.site/.test(l.href)) {
          if (!/#page/.test(l.href)) queue.push(l.href);
          continue;
        }
        if (/canva\.com\/|instagram\.com|azurewebsites\.net/.test(l.href)) continue;
        const sec = res.heading || "General";
        if (!site.sections.has(sec)) site.sections.set(sec, new Map());
        const m = site.sections.get(sec);
        if (!m.has(l.href)) m.set(l.href, []);
        m.get(l.href).push(l);
      }
    }
    sites.push(site);
  }
  await browser.close();
  return { sites, failed };
}

function toMarkdown({ sites, failed }) {
  const L = [
    "# SGI Rethink – Enlaces del Portal SGI", "",
    "Formularios, indicadores (KPIs), procedimientos, matrices, registros y documentos del Sistema de Gestión Integrado (SGI) de Rethink, tomados automáticamente del Portal SGI (" + START.join(", ") + ") y de sus páginas por proceso.", "",
    "Cuando alguien pida el enlace de cualquiera de estos elementos, responder con el nombre y el enlace completo. Los enlaces abren en SharePoint, OneDrive, Microsoft Forms, Power BI, Planner o Jotform y requieren iniciar sesión con la cuenta de la empresa.", "",
  ];
  const done = new Set();
  let count = 0;
  for (const site of sites) {
    const blocks = [];
    for (const [sec, links] of site.sections) {
      const lines = [];
      for (const [href, occ] of links) {
        const key = `${site.url}|${href}`;
        if (done.has(key)) continue;
        done.add(key);
        const label = bestLabel(occ) || "Enlace sin nombre";
        lines.push(`- ${label} (${tipo(href)}): ${href}`);
        count++;
      }
      if (lines.length) blocks.push(`### ${sec}`, "", ...lines, "");
    }
    if (blocks.length) L.push(`## ${site.title || site.url}`, `Página: ${site.url}`, "", ...blocks);
  }
  if (failed.length) L.push("## Páginas que no se pudieron abrir en el último rastreo", "", ...failed.map((u) => `- ${u}`), "");
  return { markdown: L.join("\n"), count };
}

const result = await crawl();
const { markdown, count } = toMarkdown(result);
console.log(`Sitios: ${result.sites.length} · Enlaces: ${count} · Fallidos: ${result.failed.length}`);
if (process.env.DRY_RUN) {
  console.log(markdown);
  process.exit(0);
}
if (count < 10) {
  console.error("Muy pocos enlaces: el sitio pudo cambiar o fallar. No se actualiza el documento.");
  process.exit(1);
}
const res = await fetch(`${process.env.PORTAL_URL.replace(/\/$/, "")}/api/cron/upsert-document`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.CRON_SECRET}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    key: "portal-sgi-enlaces",
    title: "SGI - Enlaces del Portal SGI",
    category: "SGI - Enlaces",
    access_level: "confidencial",
    content: markdown,
  }),
});
console.log(res.status, await res.text());
if (!res.ok) process.exit(1);
