import Link from 'next/link';

export function NavArrow({
  href,
  title,
  direction,
}: {
  href: string | null;
  title: string;
  direction: 'prev' | 'next';
}): React.JSX.Element {
  const path =
    direction === 'prev'
      ? 'M15.75 19.5 8.25 12l7.5-7.5'
      : 'm8.25 4.5 7.5 7.5-7.5 7.5';
  if (href) {
    return (
      <Link
        href={href}
        className="rounded-lg p-2 text-[#a08060] transition-colors hover:bg-[#f5edd6] hover:text-[#3d2b1f]"
        aria-label={title}
        title={title}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d={path} />
        </svg>
      </Link>
    );
  }
  return (
    <span className="cursor-default rounded-lg p-2 text-[#d4c5a9]" aria-disabled="true">
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
      </svg>
    </span>
  );
}
