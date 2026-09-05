import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Providers from '@/components/Providers';
import NavBar from '@/components/NavBar';
import ClosureBanner from '@/components/ClosureBanner';
import AuthHashHandler from '@/components/AuthHashHandler';
import FooterYear from '@/components/FooterYear';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Smittenbrot — Handgemachtes Sauerteigbrot aus Stockdorf',
  description:
    'Handgemachtes Sauerteigbrot und Gebäck aus Stockdorf bei München. Vorbestellung und Abholung. Jetzt bestellen!',
  // ?v= is a cache-buster: browsers hold on to favicons for a very long time,
  // and the 2026-09-02 white-tile favicon never showed up for anyone who had
  // the old transparent one cached. Bump the number whenever the files change.
  icons: { icon: '/favicon.png?v=2', apple: '/apple-touch-icon.png?v=2' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body className={`${inter.variable} ${inter.className}`}>
        <Providers>
          <AuthHashHandler />
          <NavBar />
          <ClosureBanner />
          <main>{children}</main>
          <footer className="border-t border-smitten-cream bg-white mt-20">
            <div className="max-w-5xl mx-auto px-4 py-10">
              <div className="grid grid-cols-1 gap-8 md:grid-cols-3 md:items-center">
                {/* Left: tagline + copyright */}
                <div className="order-2 md:order-1 text-center md:text-left">
                  <p className="text-sm text-smitten-secondary">Sauerteig aus Stockdorf</p>
                  <p className="mt-1 text-xs text-smitten-secondary/60">© <FooterYear /> Smittenbrot</p>
                </div>
                {/* Center: logo */}
                <div className="order-1 md:order-2 flex justify-center">
                  <img src="/logo.svg" alt="Smittenbrot" className="h-40 md:h-48 w-auto" />
                </div>
                {/* Right: legal links */}
                <nav className="order-3 flex flex-wrap justify-center md:justify-end gap-x-5 gap-y-2 text-sm text-smitten-secondary">
                  <a href="/faq" className="hover:text-smitten-primary transition-colors">FAQ</a>
                  <a href="/en" className="hover:text-smitten-primary transition-colors">English</a>
                  <a href="/impressum" className="hover:text-smitten-primary transition-colors">Impressum</a>
                  <a href="/datenschutz" className="hover:text-smitten-primary transition-colors">Datenschutz</a>
                  <a href="/zahlung-abholung" className="hover:text-smitten-primary transition-colors">Zahlung</a>
                  <a href="/agb" className="hover:text-smitten-primary transition-colors">AGB</a>
                  <a href="/contact" className="hover:text-smitten-primary transition-colors">Kontakt</a>
                </nav>
              </div>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
