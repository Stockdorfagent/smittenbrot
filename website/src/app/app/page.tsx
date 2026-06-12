export default function AppPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-display font-bold text-smitten-text">
        Smittenbrot App
      </h1>
      <p className="mt-4 text-smitten-text/70 leading-relaxed">
        Bestelle dein Brot und Gebäck direkt von deinem Smartphone – schneller,
        bequemer und immer auf dem neuesten Stand.
      </p>

      <div className="mt-8 bg-smitten-cream rounded-xl p-6 border border-smitten-cream">
        <h2 className="text-xl font-display font-bold text-smitten-text">
          Android App herunterladen
        </h2>
        <p className="mt-2 text-sm text-smitten-text/60">
          Lade dir die <span className="text-smitten-primary italic">Smittenbrot</span> App als APK herunter und installiere sie direkt auf deinem Android-Handy.
          Kein Google Play Store nötig.
        </p>

        <a
          href="/smittenbrot.apk"
          download
          className="mt-5 inline-flex items-center gap-2 bg-smitten-primary text-white px-6 py-3 rounded-full font-medium hover:bg-smitten-primary/90 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          APK herunterladen
        </a>
      </div>

      <div className="mt-8 space-y-6">
        <div className="bg-white rounded-xl border border-smitten-cream p-6">
          <h2 className="text-lg font-display font-bold text-smitten-text flex items-center gap-2">
            <span className="w-7 h-7 bg-smitten-primary text-white rounded-full flex items-center justify-center text-sm font-bold">1</span>
            APK herunterladen
          </h2>
          <p className="mt-2 text-sm text-smitten-text/60 ml-9">
            Tippe auf den Download-Button oben. Dein Browser lädt die <code className="text-smitten-primary bg-smitten-cream px-1 rounded">.apk</code>-Datei herunter.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-smitten-cream p-6">
          <h2 className="text-lg font-display font-bold text-smitten-text flex items-center gap-2">
            <span className="w-7 h-7 bg-smitten-primary text-white rounded-full flex items-center justify-center text-sm font-bold">2</span>
            Installation erlauben
          </h2>
          <p className="mt-2 text-sm text-smitten-text/60 ml-9">
            Beim ersten Öffnen der APK erscheint ein Hinweis. Erlaube die Installation
            von unbekannten Apps – das ist nötig, weil die App nicht über den Google Play Store
            vertrieben wird. Tippe auf <strong>„Einstellungen"</strong> und aktiviere
            <strong> „Installation unbekannter Apps erlauben"</strong> (oder ähnlich).
          </p>
        </div>

        <div className="bg-white rounded-xl border border-smitten-cream p-6">
          <h2 className="text-lg font-display font-bold text-smitten-text flex items-center gap-2">
            <span className="w-7 h-7 bg-smitten-primary text-white rounded-full flex items-center justify-center text-sm font-bold">3</span>
            Installieren & Loslegen
          </h2>
          <p className="mt-2 text-sm text-smitten-text/60 ml-9">
            Nach der Installation findest du <span className="text-smitten-primary italic">Smittenbrot</span> auf deinem Startbildschirm.
            Melde dich an oder erstelle ein Konto und bestelle dein Brot – jederzeit und überall.
          </p>
        </div>
      </div>

      <div className="mt-8 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <strong>Hinweis:</strong> Die App wird regelmäßig aktualisiert. Lade bei neuen
        Funktionen einfach die aktuelle APK herunter und installiere sie neu – deine
        Daten und Einstellungen bleiben erhalten.
      </div>
    </div>
  );
}
