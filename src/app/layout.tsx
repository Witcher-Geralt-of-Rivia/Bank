import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { IBM_Plex_Mono, Instrument_Serif, Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Aldera — Banca construida sobre un libro mayor en el que puedes confiar",
    template: "%s · Aldera",
  },
  description:
    "Aldera es una plataforma de banca digital y operaciones financieras: cuentas multimoneda, transferencias, seguimiento de transacciones en tiempo real y un registro de auditoría completo sobre un libro mayor de partida doble.",
  applicationName: "Aldera",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0d2a26",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The Content-Security-Policy carries a per-request nonce (see src/proxy.ts),
  // so no page may be prerendered at build time.
  await connection();

  return (
    <html
      lang="es"
      className={`${inter.variable} ${instrumentSerif.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
