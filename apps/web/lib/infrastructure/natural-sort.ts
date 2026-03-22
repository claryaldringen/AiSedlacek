/**
 * Natural sort comparison — numbers are compared numerically, text alphabetically.
 * "1.jpg" < "2.jpg" < "10.jpg" < "a.jpg"
 */
export function naturalCompare(a: string, b: string): number {
  const ax: (string | number)[] = [];
  const bx: (string | number)[] = [];

  a.replace(/(\d+)|(\D+)/g, (_, num, str) => {
    ax.push(num ? parseInt(num, 10) : str);
    return '';
  });
  b.replace(/(\d+)|(\D+)/g, (_, num, str) => {
    bx.push(num ? parseInt(num, 10) : str);
    return '';
  });

  for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
    const ai = ax[i];
    const bi = bx[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    if (typeof ai === 'number' && typeof bi === 'number') {
      if (ai !== bi) return ai - bi;
    } else {
      const cmp = String(ai).localeCompare(String(bi), 'cs');
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}
