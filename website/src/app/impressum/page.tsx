export default function ImpressumPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <h1 className="text-3xl font-display font-bold text-smitten-text mb-8">Impressum</h1>

      <h2 className="text-lg font-display font-bold text-smitten-text mt-8 mb-2">Angaben gemäß § 5 TMG</h2>

      <p className="text-smitten-text leading-relaxed">
        Sophia Smittenberg<br />
        Smittenbrot<br />
        Waldstr. 1<br />
        82131 Stockdorf
      </p>

      <p className="text-smitten-text leading-relaxed mt-4">
        <strong>Telefon:</strong> 0049 176 72272842<br />
        <strong>E-Mail:</strong> info@smittenbrot.de
      </p>

      <h2 className="text-lg font-display font-bold text-smitten-text mt-8 mb-2">Zuständige Kammer</h2>

      <p className="text-smitten-text leading-relaxed">
        Handwerkskammer für München und Oberbayern<br />
        Max-Joseph-Straße 4<br />
        80333 München<br />
        <a href="https://www.hwk-muenchen.de" className="text-smitten-primary hover:underline" target="_blank" rel="noopener noreferrer">www.hwk-muenchen.de</a>
      </p>

      <h2 className="text-lg font-display font-bold text-smitten-text mt-8 mb-2">Berufsrechtliche Regelungen</h2>

      <p className="text-smitten-text leading-relaxed">
        Ausnahmebewilligung nach § 8 HwO erteilt durch die Handwerkskammer für München und Oberbayern.
      </p>

      <h2 className="text-lg font-display font-bold text-smitten-text mt-8 mb-2">USt-IdNr</h2>

      <p className="text-smitten-text leading-relaxed">
        DE453765806
      </p>

      <h2 className="text-lg font-display font-bold text-smitten-text mt-8 mb-2">
        Verantwortlich für den Inhalt nach § 55 Abs. 2 MStV
      </h2>

      <p className="text-smitten-text leading-relaxed">
        Sophia Smittenberg<br />
        Waldstr. 1<br />
        82131 Stockdorf
      </p>
    </div>
  );
}
