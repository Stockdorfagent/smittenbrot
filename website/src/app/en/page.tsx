import Link from 'next/link';

/**
 * English summary page — FAQ plus pickup and payment.
 *
 * Deliberately a single static page rather than a translated site: a tester
 * asked for English, and this answers the questions a newcomer actually has
 * (when to order, where to collect, how to pay) without the cost and risk of
 * internationalising the whole app, website, emails and product catalogue.
 *
 * Pickup is presented as Waldstraße only, deliberately. That is the story for
 * someone discovering the bakery: order online, collect in the neighbourhood.
 * The other pickup points serve people who already know they are a special
 * case, and naming them here would only confuse a newcomer.
 */
export const metadata = {
  title: 'Smittenbrot — English information',
  description: 'Sourdough bakery in Stockdorf near Munich: how to order, collect and pay.',
};

const faqs: { q: string; a: string }[] = [
  {
    q: 'How do I order?',
    a: 'Choose your products and go to checkout. The next possible pickup day is selected automatically. You can order as a guest or with a customer account.',
  },
  {
    q: 'Until when can I order?',
    a: 'For Wednesday pickup, order by Monday 22:00. For Saturday pickup, order by Thursday 22:00.',
  },
  {
    q: 'Where do I collect my order?',
    a: 'From the self-service cabinet at Waldstraße 1 in Stockdorf, diagonally opposite Café Bar lumbono. You will receive an email when your order is ready, usually in the early afternoon.',
  },
  {
    q: 'When is the bread baked?',
    a: 'Sourdough needs a long fermentation, so preparation starts the day before. The bread is baked fresh on Wednesday and Saturday mornings.',
  },
  {
    q: 'How can I pay?',
    a: 'By card, and with Google Pay on Android devices. Payment is handled securely by Stripe. Payment is always in advance — cash on collection is not possible.',
  },
  {
    q: 'Can I cancel my order?',
    a: 'Yes, until the order deadline (Monday or Thursday, 22:00). After that the dough preparation begins, so changes are no longer possible.',
  },
  {
    q: 'How exactly does the subscription work?',
    a: 'You choose your favourite products and the order is placed automatically every week. On the ordering day you get a reminder at midday and can make changes or pause until 20:00. The order is then placed, and you still have until 22:00 to cancel it. After that your bread is baked fresh for you.',
  },
  {
    q: 'Can I pause my subscription?',
    a: 'Yes, at any time. Simply set how long the pause should last; afterwards the subscription continues automatically.',
  },
  {
    q: 'Can someone else collect my bread?',
    a: 'Of course. Your name and order number are on the bags, so whoever collects can find the right ones in the cabinet.',
  },
  {
    q: 'What happens if I do not collect my bread?',
    a: 'Please let us know if you cannot make it. Your bread waits in the cabinet until the next day. Unfortunately, orders that are not collected cannot be refunded.',
  },
  {
    q: 'Can I order larger quantities?',
    a: 'Planning a party or an event and need more than 10 of one product? Let us know at least a week in advance and we will plan it together.',
  },
  {
    q: 'Is the app available in English?',
    a: 'Not yet — the app and the emails are in German. This page covers the essentials. If English would genuinely help you, tell us; it is on the list.',
  },
];

export default function EnglishPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-10 text-smitten-text">
      <h1 className="text-3xl font-display font-bold">Smittenbrot in English</h1>
      <p className="mt-4 leading-relaxed">
        Handmade sourdough from Stockdorf near Munich. We bake only what has been
        ordered, so everything is fresh and nothing is wasted. Order online,
        collect on Wednesday or Saturday.
      </p>
      <p className="mt-3 text-sm text-smitten-text/60">
        The shop, the app and our emails are in German. This page answers the
        questions that matter most.
      </p>

      <h2 className="mt-10 text-xl font-display font-bold">In short</h2>
      <ul className="mt-3 space-y-2 leading-relaxed">
        <li>· Order by <strong>Monday 22:00</strong> for Wednesday, or <strong>Thursday 22:00</strong> for Saturday.</li>
        <li>· Pay in advance by card (Google Pay on Android).</li>
        <li>· Collect from the self-service cabinet at Waldstraße 1, Stockdorf.</li>
        <li>· You get an email when your order is ready.</li>
      </ul>

      <h2 className="mt-10 text-xl font-display font-bold">Questions</h2>
      <div className="mt-4 space-y-4">
        {faqs.map((faq, i) => (
          <details key={i} className="bg-white rounded-xl border border-smitten-cream group">
            <summary className="px-5 py-4 cursor-pointer font-medium hover:text-smitten-secondary transition-colors list-none flex items-center justify-between">
              {faq.q}
              <span className="text-smitten-accent group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="px-5 pb-4 text-sm text-smitten-text/70 leading-relaxed">{faq.a}</div>
          </details>
        ))}
      </div>

      <h2 className="mt-10 text-xl font-display font-bold">Cancellation and returns</h2>
      <p className="mt-3 leading-relaxed">
        You can cancel until the order deadline. After that the dough is already
        being prepared. Because the bread is fresh and perishable, it cannot be
        returned once collected.
      </p>

      <p className="mt-10 text-sm text-smitten-text/60">
        Questions in English are welcome by email:{' '}
        <span className="font-medium">info@smittenbrot.de</span>. The German pages
        have the full details: <Link href="/faq" className="underline">Häufige Fragen</Link>{' '}
        and <Link href="/zahlung-abholung" className="underline">Zahlung &amp; Abholung</Link>.
      </p>
    </div>
  );
}
