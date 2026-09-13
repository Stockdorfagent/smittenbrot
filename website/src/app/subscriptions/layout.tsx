import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Brot-Abo',
  description: 'Nie wieder den Bestellschluss verpassen: Mit dem Smittenbrot Abo wird dein Brot jede Woche automatisch vorgemerkt. Jederzeit pausierbar.',
  alternates: { canonical: '/subscriptions' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
