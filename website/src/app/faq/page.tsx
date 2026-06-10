export default function FAQPage() {
  const faqs = [
    {
      q: 'Wie bestelle ich?',
      a: 'Wähle einfach deine gewünschten Produkte aus, lege den Abholtag und -ort fest und gehe zur Kasse. Du kannst als Gast oder mit Konto bestellen.',
    },
    {
      q: 'Wann muss ich bestellen?',
      a: 'Für die Abholung am Mittwoch ist der Bestellschluss am Montag um 22:00 Uhr. Für die Abholung am Samstag ist der Bestellschluss am Donnerstag um 22:00 Uhr.',
    },
    {
      q: 'Wo kann ich bestellen?',
      a: 'Du kannst entweder in Stockdorf oder in der Feichtstraße abholen. Wähle einfach bei der Bestellung deinen Wunschort aus.',
    },
    {
      q: 'Wann wird produziert?',
      a: 'Wir backen dienstags für die Mittwochs-Abholung und freitags für die Samstags-Abholung. Dein Brot kommt immer frisch aus dem Ofen!',
    },
    {
      q: 'Kann ich mein Abo pausieren?',
      a: 'Ja, du kannst dein Abo jederzeit pausieren. Wähle einfach ein Enddatum für die Pause und wir starten automatisch wieder.',
    },
    {
      q: 'Wie bezahle ich?',
      a: 'Wir akzeptieren Kreditkarte, SEPA-Lastschrift, Apple Pay und Google Pay – alles sicher über Stripe abgewickelt.',
    },
    {
      q: 'Kann ich meine Bestellung stornieren?',
      a: 'Bis zum Bestellschluss (Montag/Donnerstag 22:00 Uhr) kannst du deine Bestellung jederzeit stornieren. Danach ist sie für die Produktion gesperrt.',
    },
    {
      q: 'Was ist, wenn ich mein Brot nicht abhole?',
      a: 'Bitte denk daran, deine Bestellung abzuholen. Nicht abgeholte Ware können wir nicht zurücknehmen.',
    },
    {
      q: 'Gibt es Rabatte bei größeren Mengen?',
      a: 'Bei Mengen über 10 Stück eines Produkts bitten wir um eine Bestätigung. Melde dich bei Fragen einfach bei uns.',
    },
    {
      q: 'Wie funktioniert das Abo genau?',
      a: 'Du legst deine Produkte fest und wir reservieren sie jede Woche für dich. Du erhältst eine Erinnerung, bevor die Bestellung ausgelöst wird, und hast bis 22:00 Uhr Zeit, Änderungen vorzunehmen.',
    },
  ];

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-display font-bold text-smitten-text">
        Häufige Fragen
      </h1>

      <div className="mt-8 space-y-4">
        {faqs.map((faq, i) => (
          <details
            key={i}
            className="bg-white rounded-xl border border-smitten-cream group"
          >
            <summary className="px-5 py-4 cursor-pointer font-medium text-smitten-text hover:text-smitten-secondary transition-colors list-none flex items-center justify-between">
              {faq.q}
              <span className="text-smitten-accent group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="px-5 pb-4 text-sm text-smitten-text/70 leading-relaxed">
              {faq.a}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
