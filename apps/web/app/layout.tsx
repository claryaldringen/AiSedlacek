import type { Metadata } from 'next';
import { SessionProvider } from 'next-auth/react';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'AiSedlacek — Čtečka starých textů',
    template: '%s — AiSedlacek',
  },
  description:
    'Nahrajte sken historického rukopisu a získejte přesný přepis, překlad do moderního jazyka, historický kontext i slovníček.',
  openGraph: {
    type: 'website',
    locale: 'cs_CZ',
    siteName: 'AiSedlacek',
    title: 'AiSedlacek — Čtečka starých textů',
    description:
      'Nahrajte sken historického rukopisu a získejte přesný přepis, překlad do moderního jazyka, historický kontext i slovníček.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AiSedlacek — Čtečka starých textů',
    description:
      'Nahrajte sken historického rukopisu a získejte přesný přepis, překlad do moderního jazyka, historický kontext i slovníček.',
  },
  metadataBase: new URL(process.env.NEXTAUTH_URL ?? 'https://aisedlacek.cz'),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="cs">
      <body className="bg-slate-800 text-slate-900">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
