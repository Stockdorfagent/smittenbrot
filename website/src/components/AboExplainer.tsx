/**
 * "So funktioniert deine Dauerbestellung" — the step-by-step explanation of the
 * Dauerbestellung (customer-facing term since 20.09.2026; the code keeps
 * "subscription"/Abo internally).
 *
 * Shown on /subscriptions to everyone who has no subscription yet: logged-out visitors
 * AND logged-in customers with an empty list. It used to live only in the
 * logged-out branch, so anyone who was signed in landed on a bare
 * "Du hast noch kein Abo eingerichtet." with no idea what they were setting up.
 * Copy is the owner's (20.09.2026, replaces commit 10002ee) — do not reword without asking.
 */
export default function AboExplainer() {
  return (
    <>
      <section className="mt-8">
        <h2 className="text-xl font-display font-bold text-smitten-text">Nie wieder Brot verpassen</h2>
        <p className="mt-3 text-smitten-text leading-relaxed">
          Einmal einrichten, danach läuft deine Bestellung automatisch. Du bekommst rechtzeitig eine Erinnerung und kannst deine Dauerbestellung jede Woche noch ändern, pausieren oder einfach so lassen, wie sie ist.
        </p>
      </section>

      <section className="mt-8 bg-smitten-cream rounded-xl p-6">
        <h3 className="font-display text-lg font-bold text-smitten-text mb-3">So funktioniert deine Dauerbestellung</h3>
        <ul className="space-y-3 text-sm text-smitten-text">
          <li className="flex gap-3">
            <span className="text-smitten-primary font-bold shrink-0">📧</span>
            <span>Am Bestelltag bekommst du mittags eine <strong>Erinnerung per E-Mail</strong>, oder als Push-Benachrichtigung, wenn du die App nutzt.</span>
          </li>
          <li className="flex gap-3">
            <span className="text-smitten-primary font-bold shrink-0">🔄</span>
            <span>Passt alles? Dann <strong>musst du nichts tun</strong>. Deine Bestellung wird um <strong>20:00 Uhr automatisch aufgegeben</strong> und der Betrag abgebucht.</span>
          </li>
          <li className="flex gap-3">
            <span className="text-smitten-primary font-bold shrink-0">✏️</span>
            <span>Möchtest du Produkte oder Mengen ändern oder deine Dauerbestellung pausieren? Das kannst du <strong>bis 20:00 Uhr</strong> ganz einfach in deinem Konto erledigen.</span>
          </li>
          <li className="flex gap-3">
            <span className="text-smitten-primary font-bold shrink-0">💳</span>
            <span>Beim Einrichten hinterlegst du einmal eine <strong>Karte</strong>. Sie wird nur für automatisch aufgegebene Bestellungen belastet. PayPal, Apple Pay und Google Pay können dafür nicht verwendet werden.</span>
          </li>
          <li className="flex gap-3">
            <span className="text-smitten-primary font-bold shrink-0">⏰</span>
            <span>Nach 20:00 Uhr kannst du die aufgegebene Bestellung noch bis <strong>22:00 Uhr stornieren</strong>. Danach wird für dich gebacken und eine Stornierung ist nicht mehr möglich.</span>
          </li>
        </ul>
      </section>
    </>
  );
}

/**
 * The alternative to a Dauerbestellung: a reminder before the cutoff. Rendered
 * BELOW the "Dauerbestellung einrichten" button (owner, 21.09.: less important
 * than setting up the subscription). Deliberately short — days, times and
 * channels are explained in the profile itself.
 */
export function ReminderHint() {
  return (
    <section className="mt-10">
      <h3 className="font-display text-lg font-bold text-smitten-text">Lieber jede Woche selbst entscheiden?</h3>
      <p className="mt-3 text-sm text-smitten-secondary leading-relaxed">
        Dann lass dich einfach vor dem Bestellschluss erinnern. Die Bestell-Erinnerung stellst du in der App
        oder online in deinem Profil ein.
      </p>
    </section>
  );
}
