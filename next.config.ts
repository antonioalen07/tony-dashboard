import type { NextConfig } from "next";

/**
 * Headers de seguridad para toda la app. Sin CSP por ahora: el tema se inyecta
 * inline y hay embeds de terceros (wsrv.nl, Instagram); una CSP mal ajustada
 * rompería más de lo que protege.
 */
const securityHeaders = [
  // Nadie puede meter el dashboard en un iframe (clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Sólo HTTPS durante 2 años (Vercel ya sirve HTTPS; esto lo hace obligatorio para el navegador).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
