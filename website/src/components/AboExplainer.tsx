/**
 * "So funktioniert dein Abo" — the step-by-step explanation of the Brot-Abo.
 *
 * Shown on /subscriptions to everyone who has no Abo yet: logged-out visitors
 * AND logged-in customers with an empty list. It used to live only in the
 * logged-out branch, so anyone who was signed in landed on a bare
 * "Du hast noch kein Abo eingerichtet." with no idea what they were setting up.
 * Copy is the owner's (commit 10002ee) — do not reword without asking.
 */
export default function AboExplainer() {
  return (
    <>
      <section className="mt-8">
        <h2 className="text-xl font-display font-bold text-smitten-text">Nie wieder Brot verpassen</h2>
        <p className="mt-3 text-smitten-text leading-relaxed">
          Weniger To-do für dich, mehr Zeit für gutes Brot. Mit dem Brot-Abo musst du nie wieder daran denken, rechtzeitig zu bestellen!
        </p>
      </section>

      <section className="mt-8 bg-smitten-cream rounded-xl p-6">
        <h3 className="font-display text-lg font-bold text-smitten-text mb-3">So funktioniert dein Abo</h3>
        <ul className="space-y-3 text-sm text-smitten-text">
          <li className="flex gap-3">
            <span className="text-smitten-primary font-bold shrink-0">📧</span>
            <span>Am Bestelltag bekommst du mittags eine <strong>Erinnerung per E-Mail</strong> (oder Push-Benachrichtigung, wenn du die App nutzt).</span>
          </li>
          <li className="flex gap-3">
            <span className="text-smitten-primary font-bold shrink-0">🔄</span>
            <span>Wenn mit deiner Bestellung alles in Ordnung ist, <strong>musst du nichts tun</strong>. Die Bestellung wird automatisch um <strong>20:00 Uhr</strong> aufgegeben und der Betrag abgebucht.</span>
          </li>
          <li className="flex gap-3">
            <span className="text-smitten-primary font-bold shrink-0">✏️</span>
            <span>Möchtest du Produkte ändern, die Menge anpassen oder das Abo pausieren? Das kannst du <strong>bis 20:00 Uhr</strong> ganz einfach in deinem Konto erledigen.</span>
          </li>
          <li className="flex gap-3">
            <span className="text-smitten-primary font-bold shrink-0">⏰</span>
            <span>Nach 20:00 Uhr hast du noch bis <strong>22:00 Uhr</strong> Zeit, die Bestellung zu stornieren. Danach ist eine Stornierung nicht mehr möglich und es wird für dich gebacken.</span>
          </li>
        </ul>
      </section>
    </>
  );
}
