export default function HomePage(): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <h2 className="mb-4 text-3xl font-bold text-stone-800">Nahrajte středověký dokument</h2>
      <p className="mb-8 max-w-2xl text-stone-600">
        Aplikace provede OCR rozpoznání textu pomocí ensemble tří enginů (Transkribus, Tesseract.js,
        Claude Vision), konsolidaci výstupů a překlad do moderní češtiny nebo němčiny.
      </p>
      <div className="rounded-lg border-2 border-dashed border-stone-300 bg-white px-16 py-12 text-stone-400">
        <p className="text-lg">Nahrávání dokumentů bude brzy k dispozici</p>
        <p className="mt-2 text-sm">Podporované formáty: JPEG, PNG, TIFF, PDF</p>
      </div>
    </div>
  );
}
