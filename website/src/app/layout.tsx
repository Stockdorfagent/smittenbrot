import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Providers from '@/components/Providers';
import NavBar from '@/components/NavBar';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Smittenbrot — Handgemachtes Sauerteigbrot aus Stockdorf',
  description:
    'Handgemachtes Sauerteigbrot und Gebäck aus Stockdorf bei München. Vorbestellung und Abholung. Jetzt bestellen!',
  icons: '/favicon.png',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body className={inter.className}>
        <Providers>
          <NavBar />
          <main>{children}</main>
          <footer className="border-t border-smitten-cream bg-white mt-20">
            <div className="max-w-5xl mx-auto px-4 py-8 flex items-center justify-between">
              <p className="text-xl font-display text-smitten-text font-bold w-1/3">Sauerteig aus Stockdorf</p>
              <div className="w-1/3 flex justify-center">
                <img src="/logo.svg" alt="Smittenbrot" className="h-40 w-auto" />
              </div>
              <div className="w-1/3 flex flex-col items-end gap-1 text-sm text-smitten-text/60">
                <a href="/impressum" className="hover:text-smitten-primary transition-colors">
                  Impressum
                </a>
                <a href="/datenschutz" className="hover:text-smitten-primary transition-colors">
                  Datenschutz
                </a>
                <a href="/zahlung-abholung" className="hover:text-smitten-primary transition-colors">
                  Zahlung
                </a>
                <a href="/agb" className="hover:text-smitten-primary transition-colors">
                  AGB
                </a>
                <a href="/contact" className="hover:text-smitten-primary transition-colors">
                  Kontakt
                </a>
              </div>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
