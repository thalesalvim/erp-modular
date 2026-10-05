import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// SVG codificado do logotipo "H" do HandyHub para uso global
const handySvgDataUri = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 500 500'><defs><linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'><stop offset='0%' stop-color='%234F46E5'/><stop offset='50%' stop-color='%237C3AED'/><stop offset='100%' stop-color='%23DB2777'/></linearGradient></defs><rect width='500' height='500' rx='110' fill='%23090D16'/><path d='M 140 130 L 200 130 L 200 220 L 300 220 L 300 130 L 360 130 L 360 370 L 300 370 L 300 270 L 200 270 L 200 370 L 140 370 Z' fill='url(%23g)'/></svg>`;

export const metadata: Metadata = {
  title: "HandyHub ERP",
  description: "Sistema de Gestão Integrado",
  icons: {
    icon: handySvgDataUri,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="icon" href={handySvgDataUri} />
      </head>
      <body className={`${inter.className} relative min-h-screen`}>
        {children}

        {/* Marca d'água corporativa HandyHub fixa no canto inferior direito de TODAS as páginas do sistema */}
        <div className="fixed bottom-3 right-4 z-[9999] flex items-center gap-2 opacity-30 hover:opacity-80 transition pointer-events-none select-none">
          <img src={handySvgDataUri} alt="HandyHub" className="w-5 h-5 rounded shadow" />
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">HandyHub ERP</span>
        </div>
      </body>
    </html>
  );
}