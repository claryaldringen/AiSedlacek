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
      <body className="overflow-hidden bg-slate-800 text-slate-900">{children}</body>
    </html>
  );
}
