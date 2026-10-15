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

/** Abre la página, espera a que cargue y devuelve el HTML ya armado. */
export async function renderPage(browser: Browser, url: string): Promise<{ html: string; finalUrl: string }> {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 25_000 });
    // Bajar hasta el final para que carguen las secciones diferidas.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight && y < 40_000; y += 700) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 80));
      }
    });
    await new Promise((r) => setTimeout(r, 500));
    return { html: await page.content(), finalUrl: page.url() };
  } finally {
    await page.close().catch(() => {});
  }
}
