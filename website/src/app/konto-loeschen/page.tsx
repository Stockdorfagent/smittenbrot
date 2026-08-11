import Link from 'next/link';

export const metadata = {
  title: 'Konto löschen – Smittenbrot',
  description: 'So löschst du dein Smittenbrot-Konto und deine Daten.',
};

// Public page (no login) documenting account + data deletion — linked from the
// Google Play & App Store listings as required.
export default function KontoLoeschenPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-smitten-text">Konto und Daten löschen – Smittenbrot</h1>
      <p className="mt-3 text-smitten-text/80">
        Du kannst dein Smittenbrot-Konto und die damit verbundenen persönlichen Daten jederzeit
        selbst löschen – in der Smittenbrot-App oder auf dieser Website.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-smitten-text">So löschst du dein Konto</h2>
      <ol className="mt-3 space-y-2 text-smitten-text/80 list-decimal list-inside">
        <li>Melde dich in der <strong>Smittenbrot-App</strong> oder auf <strong>smittenbrot.de</strong> an.</li>
        <li>Öffne <strong>Profil</strong>.</li>
        <li>Tippe bzw. klicke auf <strong>„Konto löschen"</strong> und bestätige.</li>
      </ol>
      <p className="mt-3 text-smitten-text/80">
        Die Löschung erfolgt sofort und dauerhaft. Alternativ kannst du deine Löschung per E-Mail an{' '}
        <a href="mailto:info@smittenbrot.de" className="text-smitten-primary underline">info@smittenbrot.de</a>{' '}
        anfordern – wir löschen dein Konto dann innerhalb weniger Tage.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-smitten-text">Welche Daten werden gelöscht</h2>
      <ul className="mt-3 space-y-1 text-smitten-text/80 list-disc list-inside">
        <li>Deine Kontodaten (Name, E-Mail-Adresse, Telefonnummer)</li>
        <li>Deine gespeicherte Zahlungsmethode (bei unserem Zahlungsdienstleister Stripe)</li>
        <li>Deine Abonnements</li>
        <li>Vorgemerkte Bestellungen, die noch nicht abgerechnet wurden</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold text-smitten-text">Welche Daten wir aufbewahren</h2>
      <p className="mt-3 text-smitten-text/80">
        Bereits bezahlte Bestellungen und die dazugehörigen <strong>Rechnungen</strong> müssen wir aus
        gesetzlichen Gründen aufbewahren: Nach § 147 AO (GoBD) gilt eine Aufbewahrungspflicht von{' '}
        <strong>8 Jahren</strong>. Diese Rechnungsdaten werden nach Ablauf dieser Frist ebenfalls gelöscht.
        Sie werden nicht für Werbung verwendet und nicht an Dritte weitergegeben.
      </p>

      <p className="mt-8 text-sm text-smitten-text/60">
        Weitere Informationen findest du in unserer{' '}
        <Link href="/datenschutz" className="underline">Datenschutzerklärung</Link>.
      </p>
    </main>
  );
}
