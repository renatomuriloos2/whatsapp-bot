/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: false,
  },
  experimental: {
    // Extracción de texto de PDF/Word: se cargan desde node_modules en vez de
    // empaquetarlas (unpdf usa import.meta, que webpack no soporta bien).
    serverComponentsExternalPackages: ["unpdf", "mammoth"],
    // Subida de documentos a la base de conocimiento del bot (PDF/Word).
    // Vercel limita el cuerpo de la petición a 4.5 MB.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
