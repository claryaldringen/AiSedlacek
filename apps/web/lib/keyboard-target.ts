/**
 * Má klávesu obsloužit samotný ovládací prvek s fokusem, ne zkratky workspace?
 *
 * Enter a mezerník aktivují tlačítko, odkaz nebo `<summary>` – zkratka „Enter =
 * otevřít vybranou položku" je nesmí přebít (šipka zpět ve svazku by jinak místo
 * návratu otevřela dřív vybraný svazek či stránku). Ostatní klávesy (šipky,
 * Delete, Ctrl+A) zkratky dál ovládají i s fokusem na tlačítku – po kliknutí
 * myší na tlačítko lišty zůstává fokus na něm.
 */
export function isControlActivationKey(
  key: string,
  target: { closest?: (selector: string) => unknown } | null,
): boolean {
  if (key !== 'Enter' && key !== ' ') return false;
  if (!target || typeof target.closest !== 'function') return false;
  return target.closest('button, a[href], summary, [role="button"]') != null;
}
