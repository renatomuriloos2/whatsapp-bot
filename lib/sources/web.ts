import "server-only";
import crypto from "node:crypto";
import { parse, HTMLElement, Node, TextNode } from "node-html-parser";
import type { Browser } from "puppeteer-core";
import type { RemoteFile } from "@/lib/sources/types";
import { openBrowser, renderPage } from "@/lib/sources/browser";

// Importa un sitio web (ej. un portal hecho en Canva o Google Sites): recorre
// sus páginas dentro de la misma dirección base y guarda el texto con los
// enlaces escritos al lado ("Formulario X (https://…)"), para que el bot
// pueda responder con el enlace exacto.

const MAX_PAGES = 60;
// Menos texto que esto en la página "cruda" = el sitio se arma con
// JavaScript (ej. Canva) y hay que abrirlo con el navegador interno.
const MIN_TEXT = 200;
// Tiempo máximo para recorrer el sitio (las funciones de Vercel duran 60 s).
const CRAWL_BUDGET_MS = 35_000;
const BLOCK = new Set([
  "p", "div", "section", "article", "header", "footer", "li", "ul", "ol", "tr", "table",
  "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr", "main", "nav", "aside", "figure", "blockquote",
]);
const SKIP = new Set(["script", "style", "noscript", "svg", "template", "head", "iframe"]);

interface Page {
  url: string;
  title: string;
  text: string;
  links: string[];
}

// Texto de cada página de la última lectura, para no descargarla dos veces
// (una para listar y otra para "descargar") dentro de la misma sincronización.
const pageCache = new Map<string, string>();

function absolute(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "mailto:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function htmlToText(root: HTMLElement, pageUrl: string): { text: string; links: string[] } {
  const links: string[] = [];
  const out: string[] = [];

  const walk = (node: Node) => {
    if (node instanceof TextNode) {
      out.push(node.text.replace(/\s+/g, " "));
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = node.rawTagName?.toLowerCase() ?? "";
    if (SKIP.has(tag)) return;

    if (tag === "a") {
      const href = node.getAttribute("href");
      const url = href ? absolute(href, pageUrl) : null;
      const label =
        node.text.replace(/\s+/g, " ").trim() ||
        node.getAttribute("aria-label") ||
        node.getAttribute("title") ||
        node.querySelector("img")?.getAttribute("alt") ||
        "";
      if (url) {
        links.push(url);
        out.push(label ? ` ${label} (${url}) ` : ` ${url} `);
      } else {
        out.push(label);
      }
      return;
    }
    if (tag === "img") {
      const alt = node.getAttribute("alt");
      if (alt) out.push(` ${alt} `);
      return;
    }
    if (BLOCK.has(tag)) out.push("\n");
    node.childNodes.forEach(walk);
    if (BLOCK.has(tag)) out.push("\n");
  };
  walk(root);

  const text = out
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, links };
}

function pageFromHtml(html: string, url: string): Page {
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false } });
  const title = root.querySelector("title")?.text.trim() || new URL(url).pathname;
  const body = root.querySelector("body") ?? root;
  const { text, links } = htmlToText(body, url);
  return { url, title, text, links };
}

/**
 * Estado de un recorrido: el navegador interno se abre solo si alguna página
 * lo necesita, y se reutiliza para las siguientes.
 */
class Reader {
  private browser: Browser | null = null;
  private useBrowser = false;

  async read(url: string, forceBrowser = false): Promise<Page> {
    if (forceBrowser) this.useBrowser = true;
    if (!this.useBrowser) {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; RethinkBot/1.0)", Accept: "text/html" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`El sitio respondió ${res.status} en ${url}`);
      const type = res.headers.get("content-type") ?? "";
      if (!type.includes("html")) throw new Error(`${url} no es una página web (${type}).`);
      const page = pageFromHtml(await res.text(), res.url || url);
      if (page.text.length >= MIN_TEXT) return page;
      this.useBrowser = true; // poco texto: se arma con JavaScript
    }
    this.browser ??= await openBrowser();
    const { html, finalUrl, links } = await renderPage(this.browser, url);
    const page = pageFromHtml(html, finalUrl);
    // Lista de enlaces con el nombre visible más cercano (íconos de Canva).
    const seenLinks = new Set<string>();
    const lines: string[] = [];
    for (const l of links) {
      const key = `${l.label}|${l.href}`;
      if (seenLinks.has(key) || l.href.startsWith(finalUrl.split("#")[0])) continue;
      seenLinks.add(key);
      lines.push(l.label ? `- ${l.label}: ${l.href}` : `- ${l.href}`);
    }
    if (lines.length) page.text += `\n\nEnlaces de esta página:\n${lines.join("\n")}`;
    // Menús armados con JavaScript: sus enlaces también se recorren.
    for (const l of links) {
      const abs = absolute(l.href, finalUrl);
      if (abs && !page.links.includes(abs)) page.links.push(abs);
    }
    return page;
  }

  async close() {
    await this.browser?.close().catch(() => {});
    this.browser = null;
  }
}

async function fetchPage(url: string): Promise<Page> {
  const reader = new Reader();
  try {
    return await reader.read(url);
  } finally {
    await reader.close();
  }
}

/**
 * Texto (con enlaces) de una página guardada desde el navegador
 * (Ctrl+S → "Página web completa"): sirve para sitios que arman su
 * contenido con JavaScript, porque el navegador guarda la página ya armada.
 */
export function savedHtmlToText(html: string): string {
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false } });
  const title = root.querySelector("title")?.text.trim();
  const { text } = htmlToText(root.querySelector("body") ?? root, "about:blank");
  return title ? `Página: ${title}\n\n${text}` : text;
}

/**
 * Dirección base: solo se recorren páginas que empiecen con ella. Si la
 * dirección termina en un archivo (ej. /index.html), la base es su carpeta.
 */
function baseOf(startUrl: string): string {
  const u = new URL(startUrl);
  u.hash = "";
  u.search = "";
  u.pathname = u.pathname.replace(/\/[^/]*\.[a-z0-9]+$/i, "/");
  return u.toString().replace(/\/$/, "");
}

/** Misma página aunque cambie "www.", "/index.html" o la barra final. */
function pageKey(url: string): string {
  const u = new URL(url);
  u.hash = "";
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname.replace(/\/index\.html?$/i, "/").replace(/\/$/, "");
  return `${host}${path}${u.search}`;
}

/** El enlace es del mismo sitio y está dentro de la dirección base. */
function insideBase(link: string, base: string): boolean {
  try {
    const u = new URL(link);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp4|mp3)$/i.test(u.pathname)) return false;
    const b = new URL(base);
    if (u.hostname.replace(/^www\./, "") !== b.hostname.replace(/^www\./, "")) return false;
    const path = u.pathname.replace(/\/index\.html?$/i, "/").replace(/\/$/, "");
    const root = b.pathname.replace(/\/$/, "");
    return path === root || path.startsWith(`${root}/`);
  } catch {
    return false;
  }
}

/** Páginas que el sitio declara en /sitemap.xml (si lo tiene). */
async function sitemapUrls(base: string): Promise<string[]> {
  try {
    const res = await fetch(new URL("/sitemap.xml", base), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RethinkBot/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi), (m) => m[1]).filter((u) => insideBase(u, base));
  } catch {
    return [];
  }
}

function pageLabel(page: Page, base: string): string {
  const rest = page.url.replace(base, "").replace(/^\/|\/$/g, "");
  return rest ? `${page.title} — ${decodeURIComponent(rest)}` : page.title;
}

export async function resolveWebsite(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("La dirección del sitio no es válida.");
  }
  const page = await fetchPage(url.toString());
  if (page.text.length < 40) {
    throw new Error(
      "No se encontró texto en el sitio, ni abriéndolo con el navegador interno. ¿Tiene contraseña? Ábrelo en una ventana privada para comprobarlo."
    );
  }
  return { driveId: "web", itemId: baseOf(url.toString()), name: page.title, webUrl: url.toString() };
}

export async function listWebPages(startUrl: string): Promise<RemoteFile[] & { partial?: boolean }> {
  const base = baseOf(startUrl);
  const queue = [startUrl];
  const seen = new Set<string>();
  const files: RemoteFile[] & { partial?: boolean } = [];
  const reader = new Reader();
  const deadline = Date.now() + CRAWL_BUDGET_MS;

  try {
    for (const url of await sitemapUrls(base)) queue.push(url);
    while (queue.length > 0 && seen.size < MAX_PAGES) {
      if (Date.now() > deadline) {
        // Sin tiempo para todo: lo que falta se lee en la próxima
        // sincronización y no se borra nada por no haberlo visto.
        files.partial = true;
        break;
      }
      const url = queue.shift()!;
      const key = pageKey(url);
      if (seen.has(key)) continue;
      seen.add(key);

      let page: Page;
      try {
        page = await reader.read(url);
        // Página inicial sin enlaces internos en el HTML: el menú se arma
        // con JavaScript; se vuelve a leer con el navegador interno.
        if (files.length === 0 && !page.links.some((l) => insideBase(l, base))) {
          page = await reader.read(url, true);
        }
      } catch (err) {
        if (files.length === 0) throw err; // la página inicial debe existir
        continue;
      }
      if (files.some((f) => pageKey(f.id) === pageKey(page.url))) continue; // redirigió a una ya leída
      for (const link of page.links) {
        if (insideBase(link, base) && !seen.has(pageKey(link))) queue.push(link);
      }
      if (page.text.length < 40) continue;

      const content = `Página: ${pageLabel(page, base)}\nDirección: ${page.url}\n\n${page.text}`;
      pageCache.set(page.url, content);
      files.push({
        id: page.url,
        name: `${pageLabel(page, base)}.md`,
        version: crypto.createHash("sha1").update(content).digest("hex"),
        size: content.length,
        webUrl: page.url,
        folderPath: [],
      });
    }
  } finally {
    await reader.close();
  }
  return files;
}

export async function downloadWebPage(file: RemoteFile): Promise<ArrayBuffer> {
  let content = pageCache.get(file.id);
  if (!content) {
    const page = await fetchPage(file.id);
    content = `Página: ${page.title}\nDirección: ${page.url}\n\n${page.text}`;
  }
  return new TextEncoder().encode(content).buffer as ArrayBuffer;
}
