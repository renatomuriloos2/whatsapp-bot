import "server-only";
import JSZip from "jszip";

// Lectura de Excel (.xlsx) y PowerPoint (.pptx): ambos son archivos ZIP con
// XML adentro, así que se leen con JSZip sin librerías pesadas.

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

/** Texto de todos los <t> (o <a:t>) dentro de un fragmento XML. */
function texts(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  return Array.from(xml.matchAll(re), (m) => decode(m[1])).join("");
}

const naturalOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export async function xlsxToText(data: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  const read = (path: string) => zip.file(path)?.async("string") ?? Promise.resolve("");

  const shared = Array.from((await read("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g), (m) =>
    texts(m[1], "t")
  );

  // Nombre de cada hoja → archivo XML (vía las relaciones del libro).
  const workbook = await read("xl/workbook.xml");
  const rels = await read("xl/_rels/workbook.xml.rels");
  const target = new Map(
    Array.from(rels.matchAll(/<Relationship\b[^>]*>/g), (m) => {
      const id = m[0].match(/Id="([^"]+)"/)?.[1] ?? "";
      const t = m[0].match(/Target="([^"]+)"/)?.[1] ?? "";
      return [id, t.startsWith("/") ? t.slice(1) : `xl/${t}`] as const;
    })
  );
  const sheets = Array.from(workbook.matchAll(/<sheet\b[^>]*>/g), (m) => ({
    name: decode(m[0].match(/name="([^"]+)"/)?.[1] ?? "Hoja"),
    path: target.get(m[0].match(/r:id="([^"]+)"/)?.[1] ?? "") ?? "",
    hidden: /state="(hidden|veryHidden)"/.test(m[0]),
  }));

  const out: string[] = [];
  for (const sheet of sheets) {
    if (sheet.hidden || !sheet.path) continue;
    const xml = await read(sheet.path);
    const rows: string[] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cell[1];
        const inner = cell[2] ?? "";
        const type = attrs.match(/\bt="([^"]+)"/)?.[1];
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let value = "";
        if (type === "s" && v !== undefined) value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = texts(inner, "t");
        else if (type === "b") value = v === "1" ? "VERDADERO" : "FALSO";
        else if (v !== undefined) value = decode(v);
        cells.push(value.replace(/\s+/g, " ").trim());
      }
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.some(Boolean)) rows.push(cells.join(" | "));
    }
    if (rows.length) out.push(`Hoja: ${sheet.name}\n${rows.join("\n")}`);
  }
  return out.join("\n\n");
}

export async function pptxToText(data: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  const slides = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort(naturalOrder);
  const out: string[] = [];
  for (const [i, path] of slides.entries()) {
    const xml = await zip.file(path)!.async("string");
    const paragraphs = Array.from(xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g), (m) => texts(m[1], "a:t").trim()).filter(
      Boolean
    );
    const notesPath = path.replace("slides/slide", "notesSlides/notesSlide");
    const notesXml = zip.file(notesPath) ? await zip.file(notesPath)!.async("string") : "";
    const notes = Array.from(notesXml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g), (m) => texts(m[1], "a:t").trim())
      .filter((t) => t && !/^\d+$/.test(t))
      .join("\n");
    if (paragraphs.length || notes) {
      out.push(`Diapositiva ${i + 1}\n${paragraphs.join("\n")}${notes ? `\nNotas: ${notes}` : ""}`);
    }
  }
  return out.join("\n\n");
}
