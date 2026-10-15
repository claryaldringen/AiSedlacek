/**
 * Režim „jen pro čtení" v UI – detail svazku, stránky i dokumentu vrací `canEdit`
 * (true jen pro vlastníka). Zápisové routy cizímu uživateli vrátí 404, takže UI
 * jim úpravy nemá vůbec nabízet.
 */

/** Oprávnění k úpravám načtené pro konkrétní objekt (svazek nebo stránku). */
export interface EditAccess {
  id: string;
  canEdit: boolean;
}

/**
 * `canEdit` z odpovědi detailového API. Chybí-li pole (starší API), bere se
 * true – zpětná kompatibilita, vlastníkovi se nic neskryje.
 */
export function readCanEdit(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return true;
  return (data as { canEdit?: unknown }).canEdit !== false;
}

/**
 * Je objekt `id` jen pro čtení? Načtené oprávnění platí jen pro objekt, ke
 * kterému patří – dokud se pro aktuální `id` nenačte (přechod mezi svazky,
 * otevírání stránky), použije se `fallback`.
 */
export function isReadOnly(
  access: EditAccess | null,
  id: string | null | undefined,
  fallback = false,
): boolean {
  if (!id || !access || access.id !== id) return fallback;
  return !access.canEdit;
}
