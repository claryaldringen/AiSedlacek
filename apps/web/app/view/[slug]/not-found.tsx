export default function NotFound(): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-stone-700">Tento obsah již není dostupný</h1>
        <p className="mt-2 text-stone-500">Odkaz mohl být zrušen nebo obsah smazán.</p>
      </div>
    </div>
  );
}
