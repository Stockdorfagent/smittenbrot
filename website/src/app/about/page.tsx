import Link from 'next/link';

export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-smitten-text leading-relaxed">
      <h1 className="text-3xl font-display font-bold text-smitten-text mb-2">
        <span className="text-smitten-primary italic">Smittenbrot</span> – Brot von Smittenberg
      </h1>

      <div className="flex flex-col md:flex-row md:gap-8 items-start">
        <div className="flex-1">
          <p className="mb-4" style={{ whiteSpace: 'pre-wrap' }}>
            Hallo, ich bin{' '}
            <strong>Sophia Smittenberg</strong>
            . Und ja, genau daher kommt auch der Name{' '}
            <span className="text-smitten-primary italic">Smittenbrot</span>
            . Ich komme ursprünglich aus den Niederlanden, und habe viele Jahre in Frankreich, Großbritannien und Italien studiert und gearbeitet, bevor ich schließlich in Stockdorf gelandet bin.
          </p>

          <p className="mb-4" style={{ whiteSpace: 'pre-wrap' }}>
            Nach einer langen Karriere im Online-Marketing – mit zahllosen Meetings, Reports und PowerPoint-Folien – wollte ich etwas Handfesteres. Online-Marketing kann spannend sein, aber ein{' '}
            <strong>frisch gebackenes Brot duftet einfach besser</strong>
            {' '}als jeder PowerPoint-Slide. Also habe ich den Schritt gewagt und meine Leidenschaft zum Handwerk gemacht.
          </p>

          <p className="mb-4" style={{ whiteSpace: 'pre-wrap' }}>
            Um mein Können zu vertiefen, habe ich in 2024 die Boulangerie-Ausbildung am Bakery Institute in Zaandam (NL) absolviert. Mit der Ausnahmebewilligung der Handwerkskammer München und Oberbayern in der Tasche backe ich nun für meine Nachbarschaft in Stockdorf.{' '}
            <strong>Klein, lokal und mit viel Herz.</strong>
          </p>

          <p className="mb-4" style={{ whiteSpace: 'pre-wrap' }}>
            <span className="text-smitten-primary italic">Smittenbrot</span>
            {' '}ist für mich die Verbindung von Leidenschaft und Handwerk. Jedes Brot, das aus meinem Ofen kommt, erzählt ein Stück davon und landet{' '}
            <strong>frisch und unkompliziert bei dir auf dem Tisch.</strong>
          </p>
        </div>
        <div className="flex-shrink-0 md:w-72 lg:w-80 mt-6 md:mt-0">
          <img
            src="/images/sophia-in-de-spiegel.jpeg"
            alt="Sophia Smittenberg"
            className="w-full rounded-xl shadow-md"
          />
        </div>
      </div>

      <div className="mt-10 text-center">
        <Link href="/contact" className="inline-block text-smitten-primary hover:underline text-sm">
          Kontakt &amp; Feedback →
        </Link>
      </div>
    </div>
  );
}
