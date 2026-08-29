/** The loading block every admin page had its own copy of. */
export function AdminLoading({ what }: { what: string }) {
  return (
    <div className="flex items-center justify-center py-20">
      <p className="text-smitten-text/40">Lädt {what}...</p>
    </div>
  );
}
