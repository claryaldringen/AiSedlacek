import { Link } from '@/i18n/navigation';

export default function NotFound(): React.ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f0e6d0] px-4">
      <div className="w-full max-w-lg rounded-lg border border-[#c9b99a] bg-[#faf4e8] p-8 text-center shadow-lg">
        <h1 className="mb-4 font-serif text-3xl font-bold text-[#8b1a1a]">Page not found</h1>
        <p className="mb-6 font-serif text-[#3d2b1f]">
          The requested page does not exist or has been removed.
        </p>
        <Link
          href="/"
          className="inline-block rounded-md bg-[#8b1a1a] px-6 py-2 font-serif text-white transition-colors hover:bg-[#6d1515]"
        >
          Back to homepage
        </Link>
      </div>
    </div>
  );
}
