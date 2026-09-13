import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sortiment',
  description: 'Alle Brote dieser Woche bei Smittenbrot: Stockdorf Sourdough, Brioche, Baguette, Focaccia, Ciabatta und mehr. Online vorbestellen, in Stockdorf abholen.',
  alternates: { canonical: '/products' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
