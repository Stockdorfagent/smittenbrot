
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AGB',
  description: 'Allgemeine Geschäftsbedingungen von Smittenbrot: Bestellung, Bestellautomatik (Abo), Zahlung, Stornierung und Abholung.',
  alternates: { canonical: '/agb' },
};
// AGB — Fassung vom 09.09.2026 (Bestellautomatik statt Abonnementvertrag, App im
// Geltungsbereich, § 312i-Informationen, Stornierung 22:00 Uhr, gesetzliche Haftung).
// Frühere Fassungen: git history dieser Datei (z. B. `git log -p -- website/src/app/agb/page.tsx`).
// Quelle/Arbeitsfassung: ~/Smittenbrot-App/AGB-ENTWURF-2026-08-31.txt
export default function AgbPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-smitten-text leading-relaxed">
      <h1 className="text-3xl font-display font-bold text-smitten-text mb-2">
        Allgemeine Geschäftsbedingungen (AGB)
      </h1>
      <p className="text-sm text-smitten-text/60 mb-8">Stand: 09.09.2026</p>

      <h2 className="text-xl font-display font-bold text-smitten-text mt-10 mb-3">§ 1 Geltungsbereich und Vertragspartnerin</h2>
      <p className="mb-3">(1) Diese Allgemeinen Geschäftsbedingungen gelten für alle Bestellungen, die über die Website www.smittenbrot.de oder die Smittenbrot-App (iOS und Android) aufgegeben werden — einzeln oder über die Bestellautomatik (&quot;Abo&quot;, § 3).</p>
      <p className="mb-3">(2) Vertragspartnerin ist Sophia Smittenberg, Smittenbrot, Waldstr. 1, 82131 Stockdorf. Telefon: +49 176 72272842. E-Mail: info@smittenbrot.de.</p>
      <h2 className="text-xl font-display font-bold text-smitten-text mt-10 mb-3">§ 2 Bestellung und Vertragsschluss</h2>
      <p className="mb-3">(1) Mit dem Abschluss des Bestellvorgangs über die Website oder die App gibst du ein verbindliches Angebot zum Kauf der ausgewählten Produkte ab. Der Vertrag kommt zustande, sobald der Bestellvorgang abgeschlossen und die Zahlung erfolgreich durchgeführt wurde. Nach der Bestellung erhältst du eine Bestellbestätigung per E-Mail.</p>
      <p className="mb-3">(2) Vertragssprache ist Deutsch.</p>
      <p className="mb-3">(3) Deine Eingaben kannst du vor dem Absenden der Bestellung jederzeit im Warenkorb bzw. auf der Bestellübersicht prüfen und korrigieren (Mengen ändern, Produkte entfernen). Verbindlich wird die Bestellung erst mit dem Klick auf die abschließende Bestell-Schaltfläche.</p>
      <p className="mb-3">(4) Der Vertragstext wird gespeichert. Deine Bestellungen kannst du jederzeit in deinem Kundenkonto einsehen; die jeweils aktuelle Fassung dieser AGB ist unter <a href="/agb" className="text-smitten-primary underline">www.smittenbrot.de/agb</a> abrufbar.</p>
      <h2 className="text-xl font-display font-bold text-smitten-text mt-10 mb-3">§ 3 Bestellautomatik (&quot;Abo&quot;)</h2>
      <p className="mb-3">(1) Über Website und App kannst du eine Bestellautomatik einrichten, die im Alltag und in der App &quot;Abo&quot; genannt wird. Das Abo ist kein Abonnementvertrag mit Laufzeit und kein Dauerschuldverhältnis, sondern eine von dir hinterlegte Einstellung: Die gewählten Produkte werden für jeden gewählten Abholtag (mittwochs und/oder samstags) automatisch als Bestellung vorgemerkt. Für das Abo selbst fällt keine Vergütung an; du zahlst nur die einzelnen Bestellungen.</p>
      <p className="mb-3">(2) Jede so vorgemerkte Bestellung ist eine eigenständige Einzelbestellung, für die dieselben Regeln gelten wie für jede von Hand aufgegebene Bestellung (§§ 2, 4 und 5). Sie wird dir am Bestelltag (zwei Tage vor dem Abholtag) angezeigt und angekündigt; bis zum Bestellschluss um 22:00 Uhr kannst du sie ändern oder stornieren. Zum Bestellschluss wird der Gesamtbetrag über die von dir hinterlegte Zahlungsmethode abgebucht; mit der erfolgreichen Zahlung kommt — wie in § 2 Abs. 1 — der Vertrag über diese Bestellung zustande. Danach ist sie verbindlich.</p>
      <p className="mb-3">(3) Mit dem Einrichten des Abos hinterlegst du eine Zahlungsmethode und erlaubst, dass die Beträge der einzelnen Bestellungen jeweils zum Bestellschluss darüber eingezogen werden. Schlägt eine Abbuchung fehl, kommt kein Vertrag über diese Bestellung zustande; sie wird nicht hergestellt und nicht berechnet. Du wirst benachrichtigt und kannst nach Aktualisierung der Zahlungsmethode die Bestellautomatik wieder aktivieren.</p>
      <p className="mb-3">(4) Du kannst die Bestellautomatik jederzeit und ohne Frist pausieren oder beenden. Während einer Pause und nach dem Beenden werden keine Bestellungen mehr vorgemerkt und keine Beträge abgebucht. Bereits bezahlte Bestellungen bleiben unberührt und werden wie vereinbart bereitgestellt. Nach Ablauf einer Pause läuft die Bestellautomatik automatisch weiter.</p>
      <h2 className="text-xl font-display font-bold text-smitten-text mt-10 mb-3">§ 4 Preise und Zahlung</h2>
      <p className="mb-3">Alle angegebenen Preise verstehen sich als Endpreise in Euro, einschließlich der jeweils gültigen Umsatzsteuer. Die Zahlung erfolgt ausschließlich im Voraus über die angebotenen Zahlungsmethoden. Barzahlung oder Bezahlung bei Abholung ist nicht möglich.</p>
      <h2 className="text-xl font-display font-bold text-smitten-text mt-10 mb-3">§ 5 Stornierung</h2>
      <p className="mb-3">Eine Bestellung kann bis zum Bestellschluss storniert werden — das ist der Bestelltag (zwei Tage vor dem Abholtag) um 22:00 Uhr; der jeweils geltende Bestellschluss wird im Warenkorb und im Bestellvorgang angezeigt. Nach Ablauf dieser Frist beginnt die Teigvorbereitung; eine Stornierung ist dann nicht mehr möglich.</p>
      <h2 className="text-xl font-display font-bold text-smitten-text mt-10 mb-3">§ 6 Abholung</h2>
      <p className="mb-3">(1) Die Produkte werden ausschließlich am gewählten Abholort bereitgestellt. Der Kunde bekommt eine Benachrichtigung dazu.</p>
      <p className="mb-3">(2) Mit der Bereitstellung zur Abholung am vereinbarten Abholtag geht die Gefahr des zufälligen Untergangs oder der Verschlechterung der Ware auf den Kunden über.</p>
      <p className="mb-3">(3) Größere Bestellungen (etwa für Feiern) bedürfen vorheriger Absprache — bitte nutze hierfür das <a href="/contact" className="text-smitten-primary underline">Kontaktformular</a>. Bestellungen über 250 € sind über Website und App nicht möglich; für sie werden Abholung und Details individuell vereinbart.</p>
      <h2 className="text-xl font-display font-bold text-smitten-text mt-10 mb-3">§ 7 Widerrufsrecht</h2>
      <p className="mb-3">Gemäß § 312g Abs. 2 Nr. 2 BGB besteht kein Widerrufsrecht bei Verträgen über die Lieferung von Waren, die schnell verderben können oder deren Verfallsdatum schnell überschritten würde. Ein Widerrufsrecht für die bestellten Backwaren besteht daher nicht.</p>
      <h2 className="text-xl font-display font-bold text-smitten-text mt-10 mb-3">§ 8 Haftung</h2>
      <p className="mb-3">Es gilt die gesetzliche Haftung.</p>
      <h2 className="text-xl font-display font-bold text-smitten-text mt-10 mb-3">§ 9 Anwendbares Recht</h2>
      <p className="mb-3">Es gilt das Recht der Bundesrepublik Deutschland; gegenüber Verbrauchern gilt dies nur, soweit dadurch keine zwingenden Verbraucherschutzvorschriften des Staates entzogen werden, in dem der Verbraucher seinen gewöhnlichen Aufenthalt hat.</p>
    </div>
  );
}
