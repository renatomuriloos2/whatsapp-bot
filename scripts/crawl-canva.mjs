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
    .filter((t) => vis(t.r) && !generic.test(t.text) && !/^(Terms|Designed with)/i.test(t.text) && !/(^|\\s)(INICIO|Da click)(\\s|$)/i.test(t.text));
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

// ---- Datos internos de la página de Canva --------------------------------
// Canva guarda el diseño en un JSON dentro de la página: de ahí sale el texto
// exacto de cada enlace de texto, y una etiqueta aproximada (texto más cercano)
// para los íconos con enlace.
const GENERIC_RE = /^(da|click|clic|da click|da clic|inicio|aqu[ií]|ver|ir|-|\.|i|d)$/i;
const cleanText = (t) => (t || "").replace(/\s+/g, " ").trim();

function readBootstrap(html) {
  const m = html.match(/window\['bootstrap'\] = JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
  if (!m) return null;
  try {
    return JSON.parse(new Function(`return '${m[1]}'`)());
  } catch {
    return null;
  }
}

function richTexts(o, out = [], depth = 0) {
  if (!o || typeof o !== "object" || depth > 8) return out;
  const c = o.C;
  if (c && Array.isArray(c.A) && Array.isArray(c.B) && Array.isArray(c.C) && c.A.every((x) => typeof x === "string")) {
    const full = c.A.join("");
    let pos = 0;
    const runs = c.B.map((len, i) => {
      const st = c.C[i] || {};
      const run = { text: full.slice(pos, pos + len), url: typeof st.Q === "string" ? st.Q : null, size: parseFloat(st.G) || 0 };
      pos += len;
      return run;
    });
    out.push({ text: full, runs });
    return out;
  }
  for (const [k, v] of Object.entries(o)) if (k !== "c") richTexts(v, out, depth + 1);
  return out;
}

function canvaLabels(html) {
  const boot = readBootstrap(html);
  const runLabels = new Map(); // texto exacto del enlace
  const imageLabels = new Map(); // texto más cercano (aproximado)
  const pages = boot?.page?.A?.A;
  if (!Array.isArray(pages)) return { runLabels, imageLabels };
  const urlsIn = (x) => new Set(x.runs.filter((r) => r.url).map((r) => r.url));
  const kids = (e) => (Array.isArray(e.c) && e.c[0] && e.c[0]["A?"] ? e.c : []);
  const flatten = (els, ox = 0, oy = 0, sx = 1, sy = 1, out = []) => {
    for (const e of els || []) {
      const r = { x: ox + (e.A || 0) * sx, y: oy + (e.B || 0) * sy, w: (e.D || 0) * sx, h: (e.C || 0) * sy };
      out.push({ e, r });
      const ch = kids(e);
      if (ch.length) flatten(ch, r.x, r.y, typeof e.b === "number" && e.b ? r.w / e.b : sx, typeof e.a === "number" && e.a ? r.h / e.a : sy, out);
    }
    return out;
  };
  const center = (a, b) => Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2));
  for (const p of pages) {
    const items = flatten(p.E);
    const texts = [];
    for (const it of items) for (const rt of richTexts(it.e)) {
      const t = cleanText(rt.text);
      if (t) texts.push({ t, r: it.r, size: Math.max(0, ...rt.runs.map((x) => x.size)), runs: rt.runs });
    }
    const top = texts.slice().sort((a, b) => b.size - a.size)[0];
    const near = (r, skip) => texts
      .filter((x) => x !== skip && x !== top && !GENERIC_RE.test(x.t) && x.t.length <= 120)
      .map((x) => ({ t: x.t, d: center(r, x.r) }))
      .sort((a, b) => a.d - b.d)[0];
    for (const x of texts) for (const run of x.runs) {
      if (!run.url) continue;
      let label = cleanText(run.text);
      // Un solo enlace en el cuadro de texto: el texto completo es su nombre
      // (evita nombres partidos como "MATRIZ DE MODO Y").
      if (urlsIn(x).size === 1 && x.t.length <= 100 && !/(^|\s)(INICIO|Da click)(\s|$)/i.test(x.t)) label = x.t;
      if (label && !GENERIC_RE.test(label) && label.length >= 3) {
        if (!runLabels.has(run.url) || runLabels.get(run.url).length < label.length) runLabels.set(run.url, label);
      } else {
        const n = near(x.r, x);
        if (n && n.d < 400 && !imageLabels.has(run.url)) imageLabels.set(run.url, n.t);
      }
    }
    for (const it of items) {
      const u = it.e.G;
      if (typeof u !== "string" || !/^https?:/.test(u)) continue;
      const n = near(it.r);
      if (n && n.d < 350 && !imageLabels.has(u)) imageLabels.set(u, n.t);
    }
  }
  return { runLabels, imageLabels };
}

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
function bestLabel(occ, labels) {
  const href = occ[0].href;
  const fromRun = labels.runLabels.get(href);
  if (fromRun) return fromRun;
  const options = [];
  for (const o of occ) {
    let near = o.cands.find((c) => c.d < 300);
    // Título partido en dos líneas ("Reporte de" / "Reporte de Hallazgos del SGI").
    const longer = near && o.cands.find((c) => c.d < near.d + 40 && c.text.length > near.text.length && c.text.toLowerCase().startsWith(near.text.toLowerCase()));
    if (longer) near = longer;
    // Texto propio cortado ("Matriz de Partes") → el texto cercano que lo contiene.
    if (o.own && o.own.length >= 4) {
      const fuller = o.cands.find((c) => c.d < 120 && c.text.toLowerCase().includes(o.own.toLowerCase()) && c.text.length > o.own.length);
      options.push({ text: fuller ? fuller.text : o.own, score: 0 });
    } else if (near) options.push({ text: near.text, score: near.d + 1 });
  }
  options.sort((a, b) => a.score - b.score || b.text.length - a.text.length);
  return options[0]?.text || labels.imageLabels.get(href) || "";
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
    const html = await page.content();
    const site = { url, title: await page.title(), sections: new Map(), labels: canvaLabels(html) };
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
    // Enlaces de texto que el navegador no mostró (secciones ocultas).
    const shown = new Set([...site.sections.values()].flatMap((m) => [...m.keys()]));
    for (const [href, label] of site.labels.runLabels) {
      if (shown.has(href) || /canva\.com\/|instagram\.com|azurewebsites\.net|#page/.test(href)) continue;
      if (/\.my\.canva\.site/.test(href)) { queue.push(href); continue; }
      if (!site.sections.has("Otros enlaces")) site.sections.set("Otros enlaces", new Map());
      site.sections.get("Otros enlaces").set(href, [{ href, own: label, cands: [] }]);
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
      const chosen = new Map([...links].map(([href, occ]) => [href, bestLabel(occ, site.labels)]));
      const repeats = {};
      for (const l of chosen.values()) repeats[l] = (repeats[l] || 0) + 1;
      for (const [href, l] of chosen) {
        const alt = site.labels.imageLabels.get(href);
        if (repeats[l] >= 3 && alt && !site.labels.runLabels.has(href)) chosen.set(href, alt);
      }
      for (const [href] of links) {
        const key = `${site.url}|${href}`;
        if (done.has(key)) continue;
        done.add(key);
        // Botón "Da click" sin título propio: se nombra por la sección y el proceso
        // (ej. "Indicadores – Recursos Humanos").
        const secName = sec.charAt(0).toUpperCase() + sec.slice(1).toLowerCase();
        const label = chosen.get(href) || `${secName} – ${site.title || "Portal SGI"}`;
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
