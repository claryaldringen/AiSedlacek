'use client';

import { useLocale } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

const LOCALE_LABELS: Record<string, string> = {
  en: 'EN',
  cs: 'CZ',
};

export default function LocaleSwitcher({
  variant = 'default',
}: {
  variant?: 'default' | 'dark';
}): React.JSX.Element {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const handleChange = async (newLocale: string): Promise<void> => {
    // If user is logged in, save preference
    try {
      await fetch('/api/user/locale', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: newLocale }),
      });
    } catch {
      // Not logged in or error — just redirect, cookie set by PATCH response
    }
    router.replace(pathname, { locale: newLocale });
  };

  const activeClass =
    variant === 'dark' ? 'bg-white/20 text-white' : 'bg-[#8b1a1a] text-white';
  const inactiveClass =
    variant === 'dark'
      ? 'text-white/60 hover:bg-white/10 hover:text-white'
      : 'text-[#7a6652] hover:bg-[#e8dcc6] hover:text-[#3d2b1f]';

  return (
    <div className="flex items-center gap-1">
      {routing.locales.map((l) => (
        <button
          key={l}
          onClick={() => void handleChange(l)}
          className={`rounded px-2 py-1 font-serif text-xs font-medium transition-colors ${
            l === locale ? activeClass : inactiveClass
          }`}
        >
          {LOCALE_LABELS[l] ?? l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
