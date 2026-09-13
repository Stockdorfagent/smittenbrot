
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Die Smittenbrot App',
  description: 'Brot vorbestellen, bezahlen und benachrichtigt werden, sobald es bereitliegt. Die Smittenbrot App für iPhone und Android.',
  alternates: { canonical: '/app' },
};
/**
 * The app is distributed through the stores only — no direct APK download.
 *
 * TO GO LIVE: fill in the two URLs below. While a URL is null that platform
 * shows as "in Vorbereitung" instead of a dead link.
 *   Google Play: https://play.google.com/store/apps/details?id=de.smittenbrot.app
 *   App Store:   https://apps.apple.com/de/app/id6793602303
 * Both 404 until the listings are actually published (checked 20.08.2026):
 * Android is in closed testing, iOS is on TestFlight — testers get their
 * invitation by email and do not use this page.
 */
const PLAY_URL: string | null = null;
const APP_STORE_URL: string | null = 'https://apps.apple.com/de/app/smittenbrot/id6793602303';

/**
 * Official store badges (free to use; Apple: min 40 px high on screen, clear
 * space ¼ of the height, only once the app is available; Google: min 28 px,
 * clear space ¼, no modification). Files: public/badges/app-store-de.svg
 * ("Laden im App Store", Apple's German artwork) and google-play-de.png
 * ("Jetzt bei Google Play"). While a store URL is null we show a plain text
 * card instead of the badge, as both brand guidelines require.
 */
function StoreLink({
  href,
  store,
  hint,
  badge,
  badgeAlt,
}: {
  href: string | null;
  store: string;
  hint: string;
  badge: string;
  badgeAlt: string;
}) {
  if (!href) {
    return (
      <div className="flex-1 rounded-xl border border-smitten-cream bg-white p-5">
        <p className="font-display font-bold text-smitten-text">{store}</p>
        <p className="mt-1 text-sm text-smitten-secondary">Kommt in Kürze</p>
      </div>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${store}: ${hint}`}
      className="flex-1 rounded-xl border border-smitten-cream bg-white p-5 flex flex-col items-start gap-3 transition-colors hover:border-smitten-text"
    >
      <p className="text-sm text-smitten-secondary">{hint}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={badge} alt={badgeAlt} className="h-12 w-auto" />
    </a>
  );
}

export default function AppPage() {
  const live = PLAY_URL || APP_STORE_URL;
  const availability =
    PLAY_URL && APP_STORE_URL
      ? 'Es gibt sie für iPhone und für Android.'
      : APP_STORE_URL
        ? 'Für iPhone gibt es die App im App Store. Die Android-Version ist gerade bei Google in der Prüfung und kommt in den nächsten Tagen.'
        : PLAY_URL
          ? 'Für Android gibt es die App bei Google Play. Die iPhone-Version ist gerade bei Apple in der Prüfung und kommt in den nächsten Tagen.'
          : 'Ich bereite die Veröffentlichung für iPhone und Android gerade vor. Sobald es so weit ist, findest du die App hier.';
  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-display font-bold text-smitten-text">
        Die Smittenbrot App
      </h1>
      <p className="mt-4 text-smitten-text leading-relaxed">
        Mit der App hast du mein Brot immer dabei. Du siehst, was ich diese Woche
        backe, bestellst in ein paar Sekunden vor und bekommst eine Nachricht,
        sobald dein Brot für dich bereitliegt. Und wenn du magst, richtest du ein
        Abo ein und musst nie wieder an den Bestellschluss denken.
      </p>

      <div className="mt-8">
        <h2 className="text-xl font-display font-bold text-smitten-text">
          {live ? 'App laden' : 'Bald in den App-Stores'}
        </h2>
        <p className="mt-2 text-sm text-smitten-text">{availability}</p>
        <div className="mt-5 flex flex-col gap-4 sm:flex-row">
          <StoreLink href={PLAY_URL} store="Google Play" hint="Für Android" badge="/badges/google-play-de.png" badgeAlt="Jetzt bei Google Play" />
          <StoreLink href={APP_STORE_URL} store="App Store" hint="Für iPhone" badge="/badges/app-store-de.svg" badgeAlt="Laden im App Store" />
        </div>
      </div>

      <div className="mt-8 rounded-xl bg-smitten-cream p-6">
        <h2 className="text-lg font-display font-bold text-smitten-text">
          Auch ohne App
        </h2>
        <p className="mt-2 text-sm text-smitten-text">
          Alles geht genauso hier auf der Website: einzelne Bestellungen und Abos,
          mit demselben Konto wie in der App.
        </p>
      </div>
    </div>
  );
}
