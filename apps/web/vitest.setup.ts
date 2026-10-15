import { vi } from 'vitest';
import en from './messages/en.json';
import cs from './messages/cs.json';

// `next-intl/server` se ve Vitestu načte v klientské variantě (chybí resolve
// condition `react-server`) a `getTranslations` pak vyhodí výjimku. API routes
// i auth-utils ho volají při každém requestu, proto ho v testech nahrazujeme
// jednoduchou implementací nad skutečnými překladovými soubory.
const catalogs: Record<string, unknown> = { en, cs };

function lookup(messages: unknown, path: string): string | undefined {
  let node: unknown = messages;
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

vi.mock('next-intl/server', () => ({
  getTranslations: async (opts?: { locale?: string; namespace?: string }) => {
    const locale = opts?.locale ?? 'en';
    const namespace = opts?.namespace;
    return (key: string, values?: Record<string, unknown>): string => {
      const fullKey = namespace ? `${namespace}.${key}` : key;
      const template = lookup(catalogs[locale] ?? catalogs['en'], fullKey) ?? fullKey;
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        values && name in values ? String(values[name]) : match,
      );
    };
  },
}));
