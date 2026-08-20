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
const APP_STORE_URL: string | null = null;

function StoreLink({
  href,
  store,
  hint,
}: {
  href: string | null;
  store: string;
  hint: string;
}) {
  if (!href) {
    return (
      <div className="flex-1 rounded-xl border border-smitten-cream bg-white p-5">
        <p className="font-display font-bold text-smitten-text">{store}</p>
        <p className="mt-1 text-sm text-smitten-secondary">In Vorbereitung</p>
      </div>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex-1 rounded-xl border border-smitten-text bg-smitten-text p-5 transition-opacity hover:opacity-90"
    >
      <p className="font-display font-bold text-white">{store}</p>
      <p className="mt-1 text-sm text-white/80">{hint}</p>
    </a>
  );
}

export default function AppPage() {
  const live = PLAY_URL || APP_STORE_URL;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-display font-bold text-smitten-text">
        Smittenbrot App
      </h1>
      <p className="mt-4 text-smitten-text leading-relaxed">
        Bestelle dein Brot und Gebäck direkt von deinem Smartphone – schneller,
        bequemer und immer auf dem neuesten Stand. Mit einem Abo musst du nie
        wieder daran denken, rechtzeitig zu bestellen.
      </p>

      <div className="mt-8">
        <h2 className="text-xl font-display font-bold text-smitten-text">
          {live ? 'App laden' : 'Bald in den App-Stores'}
        </h2>
        <p className="mt-2 text-sm text-smitten-text">
          {live
            ? 'Die App gibt es für Android und iPhone – Updates kommen automatisch.'
            : 'Wir bereiten die Veröffentlichung für Android und iPhone vor. Sobald es losgeht, findest du die App hier.'}
        </p>

        <div className="mt-5 flex flex-col gap-4 sm:flex-row">
          <StoreLink href={PLAY_URL} store="Google Play" hint="Für Android" />
          <StoreLink href={APP_STORE_URL} store="App Store" hint="Für iPhone" />
        </div>
      </div>

      <div className="mt-8 rounded-xl bg-smitten-cream p-6">
        <h2 className="text-lg font-display font-bold text-smitten-text">
          Auch ohne App
        </h2>
        <p className="mt-2 text-sm text-smitten-text">
          Du kannst alles auch hier auf der Website bestellen – Einzelbestellungen
          und Abos, mit demselben Konto wie in der App.
        </p>
      </div>
    </div>
  );
}
