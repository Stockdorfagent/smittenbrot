export default function FAQPage() {
  const faqs = [
    {
      q: 'Wie bestelle ich?',
      a: 'Wähle einfach deine gewünschten Produkte aus und gehe zur Kasse. Der nächstmögliche Abholtag wird automatisch ausgewählt. Bestellen kannst du ganz unkompliziert als Gast oder mit Kundenkonto.',
    },
    {
      q: 'Bis wann kann ich bestellen?',
      a: 'Für die Abholung am Mittwoch kannst du bis Montag um 22:00 Uhr bestellen. Für die Abholung am Samstag ist die Bestellung bis Donnerstag um 22:00 Uhr möglich.',
    },
    {
      q: 'Wo hole ich meine Bestellung ab?',
      a: 'Du findest deine Bestellung im Abholschrank in der Waldstraße 1 in Stockdorf (schräg gegenüber vom Café Bar lumbono). Sobald die Bestellung bereitliegt, erhältst du eine E-Mail, in der Regel am frühen Nachmittag.',
    },
    {
      q: 'Wann wird gebacken?',
      a: 'Durch die lange Reifezeit des Sauerteigs beginnt die Vorbereitung bereits am Vortag. Gebacken wird frisch am Mittwoch- bzw. Samstagmorgen.',
    },
    {
      q: 'Wie kann ich bezahlen?',
      a: 'Du kannst ganz einfach per Kreditkarte oder Google Pay bezahlen. Die Zahlung wird sicher über Stripe abgewickelt.',
    },
    {
      q: 'Kann ich meine Bestellung stornieren?',
      a: 'Ja, bis zum Bestellschluss (Montag bzw. Donnerstag um 22:00 Uhr) kannst du deine Bestellung jederzeit stornieren. Danach beginnt die Vorbereitung für dein Brot, sodass eine Änderung leider nicht mehr möglich ist.',
    },
    {
      q: 'Wie funktioniert das Abo genau?',
      a: 'Du legst deine Lieblingsprodukte fest und deine Bestellung wird jede Woche automatisch aufgegeben. Am Bestelltag bekommst du mittags eine Erinnerung und kannst bis 20:00 Uhr Änderungen vornehmen oder dein Abo pausieren. Danach wird die Bestellung ausgelöst und du hast noch bis 22:00 Uhr Zeit für eine Stornierung. Anschließend wird dein Brot frisch für dich gebacken.',
    },
    {
      q: 'Kann ich mein Abo pausieren?',
      a: 'Ja, du kannst dein Abo jederzeit pausieren. Lege einfach fest, wie lange deine Pause dauern soll, danach läuft dein Abo automatisch weiter.',
    },
    {
      q: 'Kann jemand anderes mein Brot abholen?',
      a: 'Ja, natürlich. Deine Bestellung kann auch von jemand anderem abgeholt werden. Mit deinem Namen und der Bestellnummer findet die Person die richtigen Tüten im Abholschrank.',
    },
    {
      q: 'Was passiert, wenn ich mein Brot nicht abhole?',
      a: 'Falls du deine Bestellung einmal nicht abholen kannst, gib uns bitte kurz Bescheid. Dein Brot wartet bis zum nächsten Tag im Abholschrank auf dich. Nicht abgeholte Bestellungen können leider nicht erstattet werden.',
    },
    {
      q: 'Kann ich auch größere Mengen bestellen?',
      a: 'Du planst eine Party, ein Event oder einen besonderen Anlass und möchtest mehr als 10 Stück eines Produkts bestellen? Gib uns gerne mindestens eine Woche vorher Bescheid, dann schauen wir gemeinsam was möglich ist, und planen deine Bestellung.',
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
