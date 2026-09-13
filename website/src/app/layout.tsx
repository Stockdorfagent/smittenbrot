import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Providers from '@/components/Providers';
import NavBar from '@/components/NavBar';
import ClosureBanner from '@/components/ClosureBanner';
import PromoBanner from '@/components/PromoBanner';
import AuthHashHandler from '@/components/AuthHashHandler';
import FooterYear from '@/components/FooterYear';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

const SITE = 'https://smittenbrot.de';
const DESCRIPTION =
  'Handgemachtes Sauerteigbrot aus Stockdorf bei München. Online vorbestellen, mittwochs oder samstags abholen, auf Wunsch als wöchentliches Abo.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: 'Smittenbrot – Sauerteigbrot aus Stockdorf', template: '%s | Smittenbrot' },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'de_DE',
    siteName: 'Smittenbrot',
    url: SITE,
    title: 'Smittenbrot – Sauerteigbrot aus Stockdorf',
    description: DESCRIPTION,
    images: [{ url: '/apple-touch-icon.png', width: 180, height: 180, alt: 'Smittenbrot' }],
  },
  robots: { index: true, follow: true },
  // ?v= is a cache-buster: browsers hold on to favicons for a very long time,
  // and the 2026-09-02 white-tile favicon never showed up for anyone who had
  // the old transparent one cached. Bump the number whenever the files change.
  icons: { icon: '/favicon.png?v=2', apple: '/apple-touch-icon.png?v=2' },
};

/** Structured data for Google: the bakery as a local business (address from the Impressum/AGB). */
const BAKERY_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Bakery',
  name: 'Smittenbrot',
  url: SITE,
  image: `${SITE}/apple-touch-icon.png`,
  description: DESCRIPTION,
  telephone: '+49 176 72272842',
  email: 'info@smittenbrot.de',
  address: { '@type': 'PostalAddress', streetAddress: 'Waldstr. 1', postalCode: '82131', addressLocality: 'Stockdorf', addressCountry: 'DE' },
  areaServed: ['Stockdorf', 'Gauting', 'Krailling', 'Planegg', 'München'],
  priceRange: '€',
  servesCuisine: 'Sauerteigbrot',
  sameAs: ['https://apps.apple.com/de/app/smittenbrot/id6793602303'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <head>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(BAKERY_JSON_LD) }} />
      </head>
      <body className={`${inter.variable} ${inter.className}`}>
        <Providers>
          <AuthHashHandler />
          <PromoBanner />
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
