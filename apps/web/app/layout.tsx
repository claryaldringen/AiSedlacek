import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Čtečka starých textů',
  description: 'Webová aplikace pro čtení a překlad středověkých textů pomocí OCR a AI.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="cs">
      <body className="min-h-screen bg-stone-50 text-stone-900">
        <header className="border-b border-stone-200 bg-white px-6 py-4">
          <div className="mx-auto max-w-7xl">
            <h1 className="text-xl font-semibold text-stone-800">Čtečka starých textů</h1>
            <p className="text-sm text-stone-500">
              OCR a překlad středověkých dokumentů
            </p>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
