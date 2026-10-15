import "server-only";
import crypto from "node:crypto";
import { parse, HTMLElement, Node, TextNode } from "node-html-parser";
import type { RemoteFile } from "@/lib/sources/types";

// Importa un sitio web (ej. un portal hecho en Canva o Google Sites): recorre
// sus páginas dentro de la misma dirección base y guarda el texto con los
// enlaces escritos al lado ("Formulario X (https://…)"), para que el bot
// pueda responder con el enlace exacto.

const MAX_PAGES = 60;
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

async function fetchPage(url: string): Promise<Page> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RethinkBot/1.0)", Accept: "text/html" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`El sitio respondió ${res.status} en ${url}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("html")) throw new Error(`${url} no es una página web (${type}).`);
  const root = parse(await res.text(), { blockTextElements: { script: false, style: false, noscript: false } });
  const title = root.querySelector("title")?.text.trim() || new URL(url).pathname;
  const body = root.querySelector("body") ?? root;
  const { text, links } = htmlToText(body, res.url || url);
  return { url: res.url || url, title, text, links };
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

/** Dirección base: solo se recorren páginas que empiecen con ella. */
function baseOf(startUrl: string): string {
  const u = new URL(startUrl);
  u.hash = "";
  u.search = "";
  return u.toString().replace(/\/$/, "");
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
      "El sitio casi no tiene texto legible (puede que se genere con JavaScript o tenga contraseña). Alternativa: descárgalo como PDF y súbelo."
    );
  }
  return { driveId: "web", itemId: baseOf(url.toString()), name: page.title, webUrl: url.toString() };
}

export async function listWebPages(startUrl: string): Promise<RemoteFile[]> {
  const base = baseOf(startUrl);
  const queue = [startUrl];
  const seen = new Set<string>();
  const files: RemoteFile[] = [];

  while (queue.length > 0 && seen.size < MAX_PAGES) {
    const url = queue.shift()!;
    const key = url.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);

    let page: Page;
    try {
      page = await fetchPage(url);
    } catch (err) {
      if (files.length === 0) throw err; // la página inicial debe existir
      continue;
    }
    for (const link of page.links) {
      if (link.startsWith(base) && !seen.has(link.replace(/\/$/, ""))) queue.push(link);
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
