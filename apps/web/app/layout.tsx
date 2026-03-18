import type { Metadata } from 'next';
import { SessionProvider } from 'next-auth/react';
import './globals.css';

export const metadata: Metadata = {
  title: 'AiSedlacek',
  description: 'Čtení a překlad historických rukopisů pomocí AI. Na počest Augusta Sedláčka.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="cs">
      <body className="overflow-hidden bg-slate-800 text-slate-900">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
