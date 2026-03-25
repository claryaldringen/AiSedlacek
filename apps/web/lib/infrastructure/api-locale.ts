import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';

export function getLocaleFromRequest(request: Request): string {
  const header = request.headers.get('x-locale');
  if (header && routing.locales.includes(header as (typeof routing.locales)[number])) {
    return header;
  }
  return routing.defaultLocale;
}

export async function getApiTranslations(request: Request, namespace: string) {
  const locale = getLocaleFromRequest(request);
  return getTranslations({ locale, namespace });
}
