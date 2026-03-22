'use client';

export function BuildInfo(): React.ReactElement {
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME;
  const buildHash = process.env.NEXT_PUBLIC_BUILD_HASH;

  const formatted = buildTime
    ? new Date(buildTime).toLocaleString('cs-CZ', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '–';

  return (
    <div className="fixed bottom-2 right-2 z-50 rounded bg-black/60 px-2 py-1 font-mono text-[10px] text-white/50">
      {formatted} · {buildHash ?? '–'}
    </div>
  );
}
