import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Providers from '@/components/Providers';
import NavBar from '@/components/NavBar';
import ClosureBanner from '@/components/ClosureBanner';
import AuthHashHandler from '@/components/AuthHashHandler';
import FooterYear from '@/components/FooterYear';

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
          <AuthHashHandler />
          <NavBar />
          <ClosureBanner />
          <main>{children}</main>
          <footer className="border-t border-smitten-cream bg-white mt-20">
            <div className="max-w-5xl mx-auto px-4 py-12">
              <div className="flex flex-col items-center gap-8 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-col items-center gap-2 md:items-start">
                  <img src="/small-logo.png" alt="Smittenbrot" className="h-20 md:h-24 w-auto" />
                  <p className="text-sm text-smitten-secondary">Sauerteig aus Stockdorf</p>
                </div>
                <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-smitten-secondary">
                  <a href="/impressum" className="hover:text-smitten-primary transition-colors">Impressum</a>
                  <a href="/datenschutz" className="hover:text-smitten-primary transition-colors">Datenschutz</a>
                  <a href="/zahlung-abholung" className="hover:text-smitten-primary transition-colors">Zahlung</a>
                  <a href="/agb" className="hover:text-smitten-primary transition-colors">AGB</a>
                  <a href="/contact" className="hover:text-smitten-primary transition-colors">Kontakt</a>
                </nav>
              </div>
              <p className="mt-8 text-center text-xs text-smitten-secondary/60 md:text-left">
                © <FooterYear /> Smittenbrot
              </p>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
