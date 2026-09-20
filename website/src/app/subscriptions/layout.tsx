import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dauerbestellung',
  description: 'Nie wieder den Bestellschluss verpassen: Mit der Smittenbrot Dauerbestellung wird dein Brot jede Woche automatisch vorgemerkt. Jederzeit pausierbar.',
  alternates: { canonical: '/subscriptions' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
