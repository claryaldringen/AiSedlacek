import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { SessionProvider } from 'next-auth/react';
import { BuildInfo } from '@/components/BuildInfo';
import { routing } from '@/i18n/routing';

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'metadata' });
  return {
    title: { default: t('title'), template: '%s — AiSedlacek' },
    description: t('description'),
    openGraph: {
      type: 'website',
      locale: locale === 'cs' ? 'cs_CZ' : 'en_US',
      siteName: 'AiSedlacek',
      title: t('title'),
      description: t('description'),
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
    },
    metadataBase: new URL(process.env.NEXTAUTH_URL ?? 'https://aisedlacek.cz'),
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: Props): Promise<React.ReactElement> {
  const { locale } = await params;

  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className="bg-slate-800 text-slate-900">
        <SessionProvider>
          <NextIntlClientProvider messages={messages}>
            {children}
            <BuildInfo />
          </NextIntlClientProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
