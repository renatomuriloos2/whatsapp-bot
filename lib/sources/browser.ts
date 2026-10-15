import "server-only";
import type { Browser } from "puppeteer-core";

// Navegador sin pantalla (Chromium) para leer sitios que arman su contenido
// con JavaScript, como los sitios de Canva. En Vercel usa el Chromium de
// @sparticuz/chromium; en una computadora local se puede indicar otro con
// CHROMIUM_PATH.

export async function openBrowser(): Promise<Browser> {
  const puppeteer = await import("puppeteer-core");
  const chromium = (await import("@sparticuz/chromium")).default;
  return puppeteer.launch({
    args: chromium.args,
    executablePath: process.env.CHROMIUM_PATH || (await chromium.executablePath()),
    headless: true,
  });
}

// Se ejecuta dentro de la página. Va como texto (no como función) para que
// el empaquetador no le agregue código auxiliar que no existe en el navegador.
const COLLECT_LINKS = `(() => {
  const clean = (t) => (t || "").replace(/\\s+/g, " ").trim();
  const textEls = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,span,li,div"))
    .filter((el) => {
      const t = clean(el.innerText);
      if (!t || t.length > 120) return false;
      return !Array.from(el.children).some((c) => clean(c.innerText) === t);
    })
    .map((el) => ({ el, text: clean(el.innerText), rect: el.getBoundingClientRect() }))
    .filter((t) => t.rect.width > 0 && t.rect.height > 0);

  return Array.from(document.querySelectorAll("a[href]"))
    .filter((a) => /^(https?:|mailto:)/.test(a.href))
    .map((a) => {
      const img = a.querySelector("img");
      let label = clean(a.innerText) || clean(a.getAttribute("aria-label")) || clean(a.title) || clean(img && img.alt);
      const r = a.getBoundingClientRect();
      if (!label && r.width > 0) {
        let best = "";
        let bestDistance = Infinity;
        for (const t of textEls) {
          if (a.contains(t.el) || t.el.contains(a)) continue;
          const dx = Math.max(0, r.left - t.rect.right, t.rect.left - r.right);
          const dy = Math.max(0, r.top - t.rect.bottom, t.rect.top - r.bottom);
          if (dx + dy < bestDistance) { bestDistance = dx + dy; best = t.text; }
        }
        if (bestDistance < 160) label = best;
      }
      return { href: a.href, label };
    });
})()`;

export interface RenderedLink {
  href: string;
  label: string;
}

/**
 * Abre la página, espera a que cargue y devuelve el HTML ya armado, más la
 * lista de enlaces con su nombre. En sitios como Canva el enlace suele estar
 * en un ícono y el título es un texto aparte debajo: se le asigna al enlace
 * el texto visible más cercano en pantalla.
 */
export async function renderPage(
  browser: Browser,
  url: string
): Promise<{ html: string; finalUrl: string; links: RenderedLink[] }> {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 25_000 });
    // Bajar hasta el final para que carguen las secciones diferidas.
    await page.evaluate(`(async () => {
      for (let y = 0; y < document.body.scrollHeight && y < 40000; y += 700) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 80));
      }
    })()`);
    await new Promise((r) => setTimeout(r, 500));
    const links = new Map<string, RenderedLink>();
    const addLinks = (found: RenderedLink[]) => {
      for (const l of found) {
        const prev = links.get(l.href);
        if (!prev || (!prev.label && l.label)) links.set(l.href, l);
      }
    };
    addLinks((await page.evaluate(COLLECT_LINKS)) as RenderedLink[]);

    // Sitios de una sola página con secciones "#page-…" (Canva): las
    // secciones ocultas no tienen posición en pantalla, así que se visita
    // cada una para poder ponerle a sus íconos el título correcto.
    const hashes = (await page.evaluate(`Array.from(new Set(
      Array.from(document.querySelectorAll("a[href^='#']"))
        .map((a) => a.getAttribute("href"))
        .filter((h) => h && h.length > 1)
    )).slice(0, 30)`)) as string[];
    for (const hash of hashes) {
      const h = JSON.stringify(hash);
      await page.evaluate(`(async () => {
        const target = Array.from(document.querySelectorAll("a[href^='#']")).find((a) => a.getAttribute("href") === ${h});
        if (target) target.click(); else location.hash = ${h};
        await new Promise((r) => setTimeout(r, 900));
        for (let y = 0; y < document.body.scrollHeight && y < 40000; y += 700) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 60));
        }
      })()`);
      addLinks((await page.evaluate(COLLECT_LINKS)) as RenderedLink[]);
    }

    return { html: await page.content(), finalUrl: page.url(), links: Array.from(links.values()) };
  } finally {
    await page.close().catch(() => {});
  }
}
