'use client';

import { useTranslations } from 'next-intl';

export default function NotFound(): React.JSX.Element {
  const t = useTranslations('errors');

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-stone-700">{t('contentUnavailable')}</h1>
        <p className="mt-2 text-stone-500">{t('contentRemovedDescription')}</p>
      </div>
    </div>
  );
}
