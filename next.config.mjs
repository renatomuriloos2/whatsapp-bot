/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: false,
  },
  // Extracción de texto de PDF/Word: se cargan desde node_modules en vez de
  // empaquetarlas (unpdf usa import.meta, que webpack no soporta bien).
  serverExternalPackages: ["unpdf", "mammoth", "word-extractor", "@sparticuz/chromium", "puppeteer-core"],
  // El Chromium comprimido de @sparticuz/chromium se lee en tiempo de
  // ejecución; hay que incluirlo en las funciones que leen sitios web.
  outputFileTracingIncludes: {
    "/carpetas": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/cron/sync-carpetas": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  experimental: {
    // Subida de documentos a la base de conocimiento del bot (PDF/Word).
    // Vercel limita el cuerpo de la petición a 4.5 MB.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
