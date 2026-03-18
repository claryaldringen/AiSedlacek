import { NextRequest } from 'next/server';

/**
 * Given an image URL, try to discover related pages by pattern matching.
 *
 * Strategies (tried in order, first match wins):
 * 1. IIIF-style: .../ID0009V/full/full/0/default.jpg — vary the page segment
 * 2. Folio in filename: ...folio_001r.jpg → 001v, 002r, 002v, ...
 * 3. Simple numeric: ...page_003.jpg → 004, 005, ...
 */
export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  const { url } = (body as { url?: string }) ?? {};
  if (typeof url !== 'string' || url.trim() === '') {
    return Response.json({ error: 'Chybí url' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: event, ...data as Record<string, unknown> })}\n\n`));
      };

      try {
        const parsed = new URL(url.trim());
        const segments = parsed.pathname.split('/');
        const pageSegment = findPageSegment(segments);

        if (pageSegment) {
          const srcSegment = segments[pageSegment.index]!;
          send('source', {
            label: formatPageLabel(srcSegment, pageSegment.prefix),
            thumbnailUrl: buildThumbnailUrl(url.trim(), parsed, segments),
          });
        }

        if (pageSegment) {
          const { index, prefix, num, pad, suffix } = pageSegment;
          const isFolio = suffix === 'R' || suffix === 'V';
          const MAX_PAGES = 999;
          const MAX_CONSECUTIVE_MISSES = 10;
          let count = 0;

          const buildCandidateUrl = (n: number, side: string): { candidateStr: string; candidate: string; newSegments: string[] } => {
            const candidate = `${prefix}${String(n).padStart(pad, '0')}${side}`;
            const newSegments = [...segments];
            newSegments[index] = candidate;
            const candidateUrl = new URL(newSegments.join('/'), parsed.origin);
            candidateUrl.search = parsed.search;
            return { candidateStr: candidateUrl.toString(), candidate, newSegments };
          };

          const tryAdd = async (n: number, side: string): Promise<boolean> => {
            const { candidateStr, candidate, newSegments } = buildCandidateUrl(n, side);
            if (candidateStr === url.trim()) return true;
            const exists = await checkUrlExists(candidateStr);
            if (exists) {
              const label = formatPageLabel(candidate, prefix);
              const thumbUrl = buildThumbnailUrl(candidateStr, parsed, newSegments);
              send('found', { url: candidateStr, label, thumbnailUrl: thumbUrl });
              count++;
              return true;
            }
            return false;
          };

          if (isFolio) {
            let misses = 0;
            for (let n = num; count < MAX_PAGES && misses < MAX_CONSECUTIVE_MISSES; n++) {
              const sides = n === num ? (suffix === 'R' ? ['V'] : []) : ['R', 'V'];
              let anyFound = false;
              for (const s of sides) {
                if (await tryAdd(n, s)) anyFound = true;
              }
              if (!anyFound && n !== num) misses++;
              else misses = 0;
            }
            misses = 0;
            for (let n = num - 1; n > 0 && count < MAX_PAGES && misses < MAX_CONSECUTIVE_MISSES; n--) {
              let anyFound = false;
              for (const s of ['R', 'V']) {
                if (await tryAdd(n, s)) anyFound = true;
              }
              if (!anyFound) misses++;
              else misses = 0;
            }
          } else {
            let misses = 0;
            for (let n = num + 1; count < MAX_PAGES && misses < MAX_CONSECUTIVE_MISSES; n++) {
              if (await tryAdd(n, '')) misses = 0;
              else misses++;
            }
            misses = 0;
            for (let n = num - 1; n > 0 && count < MAX_PAGES && misses < MAX_CONSECUTIVE_MISSES; n--) {
              if (await tryAdd(n, '')) misses = 0;
              else misses++;
            }
          }
        }

        send('done', { });
      } catch {
        send('done', { });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}


interface PageSegment {
  index: number;
  prefix: string;
  num: number;
  pad: number;
  suffix: string; // 'R', 'V', or ''
}

/**
 * Scan URL path segments to find one that looks like a page identifier.
 * Matches patterns like: ID0009V, f001r, page003, 0042, folio12v
 * Skips segments that are clearly not page IDs (full, default, 0, etc.)
 */
function findPageSegment(segments: string[]): PageSegment | null {
  const SKIP = new Set(['', 'full', 'default', 'max', 'native', 'color', 'gray', 'bitonal']);

  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    if (SKIP.has(seg.toLowerCase())) continue;
    // Skip pure single-digit segments (like IIIF rotation "0")
    if (/^\d$/.test(seg)) continue;
    // Skip file extensions
    if (/\.[a-z]{2,4}$/i.test(seg)) {
      // Check if filename itself has a page pattern — handled by fallback
      continue;
    }

    // Match: optional prefix + digits + optional R/V suffix
    const match = seg.match(/^([A-Za-z_-]*)(\d{2,})([RVrv])?$/);
    if (match) {
      return {
        index: i,
        prefix: match[1]!,
        num: parseInt(match[2]!, 10),
        pad: match[2]!.length,
        suffix: (match[3] ?? '').toUpperCase(),
      };
    }
  }
  return null;
}



/**
 * Extract a human-readable page label from the segment.
 * "ID0009V" → "9v", "folio_003r" → "3r", "page_042" → "42"
 */
function formatPageLabel(segment: string, prefix: string): string {
  // Strip prefix and extension
  let label = segment;
  if (prefix && label.startsWith(prefix)) {
    label = label.slice(prefix.length);
  }
  label = label.replace(/\.[a-z]{2,4}$/i, '');
  // Strip leading zeros but keep at least one digit
  label = label.replace(/^0+(?=\d)/, '');
  // Lowercase r/v suffix
  label = label.replace(/([RV])$/i, (c) => c.toLowerCase());
  return label;
}

/**
 * Build a thumbnail URL. For IIIF URLs, replace /full/full/ with /full/150,/
 * to get a small thumbnail. For non-IIIF, return the full URL.
 */
function buildThumbnailUrl(fullUrl: string, parsed: URL, segments: string[]): string {
  // IIIF pattern: .../identifier/region/size/rotation/quality.format
  // Replace size segment "full" with "150," for thumbnail
  const sizeIndex = segments.findIndex((s, i) =>
    s === 'full' && i > 0 && segments[i - 1] === 'full',
  );
  if (sizeIndex > 0) {
    const thumbSegments = [...segments];
    thumbSegments[sizeIndex] = '150,';
    const thumbUrl = new URL(thumbSegments.join('/'), parsed.origin);
    thumbUrl.search = parsed.search;
    return thumbUrl.toString();
  }
  return fullUrl;
}

async function checkUrlExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'AiSedlacek/1.0 (manuscript OCR tool)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') ?? '';
    return ct.startsWith('image/');
  } catch {
    return false;
  }
}
