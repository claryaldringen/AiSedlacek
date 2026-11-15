'use client';

import { useLocale } from 'next-intl';
import { usePathname as useNextPathname, useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

const LOCALES: Record<string, { flag: string; label: string }> = {
  en: { flag: '🇬🇧', label: 'English' },
  cs: { flag: '🇨🇿', label: 'Čeština' },
};

/**
 * Vzhled podle okolí: `default` – pergamenový styl přihlášení, `dark` – tmavá
 * hlavička veřejných stránek, `app` – šedá (slate) paleta aplikace (postranní panel).
 */
const VARIANT_CLASSES = {
  default: 'rounded-lg bg-[#f5edd6] text-[#3d2b1f] border-[#d4c5a9] hover:bg-[#ebe0c8]',
  dark: 'rounded-lg bg-white/10 text-white border-white/20 hover:bg-white/20',
  app: 'rounded-md bg-white text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900 focus-visible:border-blue-400 focus-visible:ring-1 focus-visible:ring-blue-400',
} as const;

export default function LocaleSwitcher({
  variant = 'default',
}: {
  variant?: keyof typeof VARIANT_CLASSES;
}): React.JSX.Element {
  const locale = useLocale();
  const router = useRouter();
  const nextPathname = useNextPathname();
  const searchParams = useSearchParams();

  const handleChange = async (newLocale: string): Promise<void> => {
    try {
      await fetch('/api/user/locale', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: newLocale }),
      });
    } catch {
      // Not logged in or error — just redirect, cookie set by PATCH response
    }

    // Strip locale prefix to get the raw pathname
    const localePrefix = new RegExp(`^/(${routing.locales.join('|')})`);
    const rawPath = nextPathname.replace(localePrefix, '') || '/';

    // Preserve query parameters
    const qs = searchParams.toString();
    const fullPath = qs ? `${rawPath}?${qs}` : rawPath;

    router.replace(fullPath, { locale: newLocale });
  };

  return (
    <select
      value={locale}
      onChange={(e) => void handleChange(e.target.value)}
      className={`cursor-pointer border px-2 py-1.5 text-xs font-medium outline-hidden transition-colors ${VARIANT_CLASSES[variant]}`}
    >
      {routing.locales.map((l) => {
        const info = LOCALES[l];
        return (
          <option key={l} value={l}>
            {info ? `${info.flag} ${info.label}` : l.toUpperCase()}
          </option>
        );
      })}
    </select>
  );
}
