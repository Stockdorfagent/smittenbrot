/**
 * The public website, in one place.
 *
 * The app links out to pages that belong on the website and would be silly to
 * duplicate here — the FAQ, pickup and payment info, and the legal pages. When
 * smittenbrot.de moves off Squarespace onto this site, this constant is the
 * only thing in the app that has to change, and the app must be rebuilt for it
 * to take effect (there is no over-the-air config).
 */
export const SITE_URL = 'https://smittenbrot-website.vercel.app';

export interface SiteLink {
  label: string;
  path: string;
}

/**
 * Pages reachable from Profil. Order is deliberate: the two people actually
 * look for first, then the legally required ones.
 */
export const SITE_LINKS: SiteLink[] = [
  { label: 'Häufige Fragen', path: '/faq' },
  { label: 'Zahlung & Abholung', path: '/zahlung-abholung' },
  { label: 'Kontakt', path: '/contact' },
  { label: 'AGB', path: '/agb' },
  { label: 'Datenschutz', path: '/datenschutz' },
  { label: 'Impressum', path: '/impressum' },
];

export function siteUrl(path: string): string {
  return `${SITE_URL}${path}`;
}
