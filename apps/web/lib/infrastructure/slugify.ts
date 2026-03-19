import { prisma } from '@/lib/infrastructure/db';

export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return slug || 'shared';
}

export async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;

  while (true) {
    const existing = await prisma.publicSlug.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
    candidate = `${base}-${suffix}`;
    suffix++;
    if (suffix > 100) throw new Error('Cannot generate unique slug');
  }
}

export function validateSlug(slug: string): string | null {
  if (slug.length < 3) return 'Slug musí mít alespoň 3 znaky';
  if (slug.length > 80) return 'Slug může mít maximálně 80 znaků';
  if (!/^[a-z0-9-]+$/.test(slug)) return 'Slug může obsahovat pouze malá písmena, čísla a pomlčky';
  if (slug.startsWith('-') || slug.endsWith('-')) return 'Slug nesmí začínat ani končit pomlčkou';
  return null;
}
