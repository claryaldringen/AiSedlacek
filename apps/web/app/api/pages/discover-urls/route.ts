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

  const { url, direction, limit, offset } =
    (body as { url?: string; direction?: string; limit?: number; offset?: number }) ?? {};
  if (typeof url !== 'string' || url.trim() === '') {
    return Response.json({ error: 'Chybí url' }, { status: 400 });
  }
  const scanDirection = direction === 'forward' || direction === 'backward' ? direction : 'both';
  const pageLimit = typeof limit === 'number' && limit > 0 ? limit : 20;
  const skipCount = typeof offset === 'number' && offset > 0 ? offset : 0;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown): void => {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: event, ...(data as Record<string, unknown>) })}\n\n`,
          ),
        );
      };

      try {
        const parsed = new URL(url.trim());
        const segments = parsed.pathname.split('/');
        const iiifId = findIIIFIdentifier(segments);
        const pageSegment = !iiifId ? findPageSegment(segments) : null;
        const queryParam = !iiifId && !pageSegment ? findNumericQueryParam(parsed) : null;

        if (iiifId) {
          const label = `${iiifId.num}${iiifId.folioSuffix.toLowerCase()}`;
          send('source', {
            label,
            thumbnailUrl: buildThumbnailUrl(url.trim(), parsed, segments),
          });
        } else if (pageSegment) {
          const srcSegment = segments[pageSegment.index]!;
          send('source', {
            label: formatPageLabel(srcSegment, pageSegment.prefix),
            thumbnailUrl: buildThumbnailUrl(url.trim(), parsed, segments),
          });
        } else if (queryParam) {
          send('source', {
            label: `${queryParam.key}=${queryParam.num}`,
            thumbnailUrl: url.trim(),
          });
        }

        const scanForward = scanDirection === 'both' || scanDirection === 'forward';
        const scanBackward = scanDirection === 'both' || scanDirection === 'backward';

        if (iiifId) {
          const MAX_CONSECUTIVE_MISSES = 10;
          const { segmentIndex, prefix, num, pad, suffix, folioSuffix, identifierHead } = iiifId;
          const isFolio = folioSuffix === 'R' || folioSuffix === 'V';
          let forwardCount = 0;
          let backwardCount = 0;
          let hasMoreForward = false;
          let hasMoreBackward = false;
          const forwardSkip = scanForward ? skipCount : 0;
          const backwardSkip = scanBackward ? skipCount : 0;
          let forwardFound = 0;
          let backwardFound = 0;

          const buildIIIFCandidate = (
            n: number,
            side: string,
          ): { candidateStr: string; label: string; newSegments: string[] } => {
            const lastPart = `${prefix}${String(n).padStart(pad, '0')}${side}${suffix}`;
            const newIdentifier = identifierHead + lastPart;
            const encoded = encodeURIComponent(newIdentifier);
            const newSegments = [...segments];
            newSegments[segmentIndex] = encoded;
            const candidateUrl = new URL(newSegments.join('/'), parsed.origin);
            candidateUrl.search = parsed.search;
            const label = `${n}${side.toLowerCase()}`;
            return { candidateStr: candidateUrl.toString(), label, newSegments };
          };

          const checkIIIF = async (
            n: number,
            side: string,
          ): Promise<{
            exists: boolean;
            candidateStr: string;
            label: string;
            newSegments: string[];
          }> => {
            const { candidateStr, label, newSegments } = buildIIIFCandidate(n, side);
            if (candidateStr === url.trim())
              return { exists: true, candidateStr, label, newSegments };
            const exists = await checkUrlExists(candidateStr);
            return { exists, candidateStr, label, newSegments };
          };

          const emitIIIFFound = (
            candidateStr: string,
            label: string,
            newSegments: string[],
          ): void => {
            const thumbUrl = buildThumbnailUrl(candidateStr, parsed, newSegments);
            send('found', { url: candidateStr, label, thumbnailUrl: thumbUrl });
          };

          if (isFolio) {
            if (scanForward) {
              let misses = 0;
              for (let n = num; forwardCount < pageLimit && misses < MAX_CONSECUTIVE_MISSES; n++) {
                const sides = n === num ? (folioSuffix === 'R' ? ['V'] : []) : ['R', 'V'];
                let anyFound = false;
                for (const s of sides) {
                  if (forwardCount >= pageLimit) break;
                  const r = await checkIIIF(n, s);
                  if (r.exists && r.candidateStr !== url.trim()) {
                    forwardFound++;
                    anyFound = true;
                    if (forwardFound > forwardSkip) {
                      emitIIIFFound(r.candidateStr, r.label, r.newSegments);
                      forwardCount++;
                    }
                  }
                }
                if (!anyFound && n !== num) misses++;
                else misses = 0;
              }
              if (forwardCount >= pageLimit) hasMoreForward = true;
            }
            if (scanBackward) {
              let misses = 0;
              for (
                let n = num - 1;
                n > 0 && backwardCount < pageLimit && misses < MAX_CONSECUTIVE_MISSES;
                n--
              ) {
                let anyFound = false;
                for (const s of ['R', 'V']) {
                  if (backwardCount >= pageLimit) break;
                  const r = await checkIIIF(n, s);
                  if (r.exists && r.candidateStr !== url.trim()) {
                    backwardFound++;
                    anyFound = true;
                    if (backwardFound > backwardSkip) {
                      emitIIIFFound(r.candidateStr, r.label, r.newSegments);
                      backwardCount++;
                    }
                  }
                }
                if (!anyFound) misses++;
                else misses = 0;
              }
              if (backwardCount >= pageLimit) hasMoreBackward = true;
            }
          } else {
            if (scanForward) {
              let misses = 0;
              for (
                let n = num + 1;
                forwardCount < pageLimit && misses < MAX_CONSECUTIVE_MISSES;
                n++
              ) {
                const r = await checkIIIF(n, '');
                if (r.exists && r.candidateStr !== url.trim()) {
                  forwardFound++;
                  if (forwardFound > forwardSkip) {
                    emitIIIFFound(r.candidateStr, r.label, r.newSegments);
                    forwardCount++;
                  }
                  misses = 0;
                } else if (r.candidateStr !== url.trim()) {
                  misses++;
                }
              }
              if (forwardCount >= pageLimit) hasMoreForward = true;
            }
            if (scanBackward) {
              let misses = 0;
              for (
                let n = num - 1;
                n > 0 && backwardCount < pageLimit && misses < MAX_CONSECUTIVE_MISSES;
                n--
              ) {
                const r = await checkIIIF(n, '');
                if (r.exists && r.candidateStr !== url.trim()) {
                  backwardFound++;
                  if (backwardFound > backwardSkip) {
                    emitIIIFFound(r.candidateStr, r.label, r.newSegments);
                    backwardCount++;
                  }
                  misses = 0;
                } else if (r.candidateStr !== url.trim()) {
                  misses++;
                }
              }
              if (backwardCount >= pageLimit) hasMoreBackward = true;
            }
          }
          send('has_more', {
            forward: hasMoreForward,
            backward: hasMoreBackward,
            forwardTotal: forwardCount + (scanForward ? skipCount : 0),
            backwardTotal: backwardCount + (scanBackward ? skipCount : 0),
          });
        } else if (queryParam) {
          // Query-param URLs (like esbirky.cz ?id=N) have sparse ID spaces
          // — use higher miss tolerance than path-segment URLs
          const MAX_CONSECUTIVE_MISSES = 50;
          const { key, num } = queryParam;
          let forwardCount = 0;
          let backwardCount = 0;
          let hasMoreForward = false;
          let hasMoreBackward = false;
          const forwardSkip = scanForward ? skipCount : 0;
          const backwardSkip = scanBackward ? skipCount : 0;

          const checkQuery = async (
            n: number,
          ): Promise<{ exists: boolean; candidateStr: string }> => {
            const candidateUrl = new URL(parsed.toString());
            candidateUrl.searchParams.set(key, String(n));
            const candidateStr = candidateUrl.toString();
            if (candidateStr === url.trim()) return { exists: true, candidateStr };
            const exists = await checkUrlExists(candidateStr);
            return { exists, candidateStr };
          };

          if (scanForward) {
            let misses = 0;
            let found = 0; // total found including skipped
            let stoppedByMisses = false;
            for (
              let n = num + 1;
              forwardCount < pageLimit && misses < MAX_CONSECUTIVE_MISSES;
              n++
            ) {
              const { exists, candidateStr } = await checkQuery(n);
              if (exists && candidateStr !== url.trim()) {
                found++;
                if (found > forwardSkip) {
                  send('found', {
                    url: candidateStr,
                    label: `${key}=${n}`,
                    thumbnailUrl: candidateStr,
                  });
                  forwardCount++;
                }
                misses = 0;
              } else if (candidateStr !== url.trim()) {
                misses++;
              }
            }
            stoppedByMisses = misses >= MAX_CONSECUTIVE_MISSES;
            // Report has_more if we hit pageLimit OR if we stopped due to gaps but found pages
            if (forwardCount >= pageLimit || (stoppedByMisses && forwardCount > 0))
              hasMoreForward = true;
          }
          if (scanBackward) {
            let misses = 0;
            let found = 0;
            let stoppedByMisses = false;
            let lastN = num - 1;
            for (
              let n = num - 1;
              n > 0 && backwardCount < pageLimit && misses < MAX_CONSECUTIVE_MISSES;
              n--
            ) {
              lastN = n;
              const { exists, candidateStr } = await checkQuery(n);
              if (exists && candidateStr !== url.trim()) {
                found++;
                if (found > backwardSkip) {
                  send('found', {
                    url: candidateStr,
                    label: `${key}=${n}`,
                    thumbnailUrl: candidateStr,
                  });
                  backwardCount++;
                }
                misses = 0;
              } else if (candidateStr !== url.trim()) {
                misses++;
              }
            }
            stoppedByMisses = misses >= MAX_CONSECUTIVE_MISSES;
            // Report has_more if we hit pageLimit, or stopped by gaps (but not if we reached id=1)
            if (backwardCount >= pageLimit || (stoppedByMisses && backwardCount > 0 && lastN > 1))
              hasMoreBackward = true;
          }
          send('has_more', {
            forward: hasMoreForward,
            backward: hasMoreBackward,
            forwardTotal: forwardCount + (scanForward ? skipCount : 0),
            backwardTotal: backwardCount + (scanBackward ? skipCount : 0),
          });
        } else if (pageSegment) {
          const MAX_CONSECUTIVE_MISSES = 10;
          const { index, prefix, num, pad, suffix } = pageSegment;
          const isFolio = suffix === 'R' || suffix === 'V';
          let forwardCount = 0;
          let backwardCount = 0;
          let hasMoreForward = false;
          let hasMoreBackward = false;
          const forwardSkip = scanForward ? skipCount : 0;
          const backwardSkip = scanBackward ? skipCount : 0;
          let forwardFound = 0;
          let backwardFound = 0;

          const buildCandidateUrl = (
            n: number,
            side: string,
          ): { candidateStr: string; candidate: string; newSegments: string[] } => {
            const ext = pageSegment.fileExtension ?? '';
            const candidate = `${prefix}${String(n).padStart(pad, '0')}${side}${ext}`;
            const newSegments = [...segments];
            newSegments[index] = candidate;
            const candidateUrl = new URL(newSegments.join('/'), parsed.origin);
            candidateUrl.search = parsed.search;
            return { candidateStr: candidateUrl.toString(), candidate, newSegments };
          };

          const checkSeg = async (
            n: number,
            side: string,
          ): Promise<{
            exists: boolean;
            candidateStr: string;
            candidate: string;
            newSegments: string[];
          }> => {
            const { candidateStr, candidate, newSegments } = buildCandidateUrl(n, side);
            if (candidateStr === url.trim())
              return { exists: true, candidateStr, candidate, newSegments };
            const exists = await checkUrlExists(candidateStr);
            return { exists, candidateStr, candidate, newSegments };
          };

          const emitFound = (
            candidateStr: string,
            candidate: string,
            newSegments: string[],
          ): void => {
            const label = formatPageLabel(candidate, prefix);
            const thumbUrl = buildThumbnailUrl(candidateStr, parsed, newSegments);
            send('found', { url: candidateStr, label, thumbnailUrl: thumbUrl });
          };

          if (isFolio) {
            if (scanForward) {
              let misses = 0;
              for (let n = num; forwardCount < pageLimit && misses < MAX_CONSECUTIVE_MISSES; n++) {
                const sides = n === num ? (suffix === 'R' ? ['V'] : []) : ['R', 'V'];
                let anyFound = false;
                for (const s of sides) {
                  if (forwardCount >= pageLimit) break;
                  const { exists, candidateStr, candidate, newSegments } = await checkSeg(n, s);
                  if (exists && candidateStr !== url.trim()) {
                    forwardFound++;
                    anyFound = true;
                    if (forwardFound > forwardSkip) {
                      emitFound(candidateStr, candidate, newSegments);
                      forwardCount++;
                    }
                  }
                }
                if (!anyFound && n !== num) misses++;
                else misses = 0;
              }
              if (forwardCount >= pageLimit) hasMoreForward = true;
            }
            if (scanBackward) {
              let misses = 0;
              for (
                let n = num - 1;
                n > 0 && backwardCount < pageLimit && misses < MAX_CONSECUTIVE_MISSES;
                n--
              ) {
                let anyFound = false;
                for (const s of ['R', 'V']) {
                  if (backwardCount >= pageLimit) break;
                  const { exists, candidateStr, candidate, newSegments } = await checkSeg(n, s);
                  if (exists && candidateStr !== url.trim()) {
                    backwardFound++;
                    anyFound = true;
                    if (backwardFound > backwardSkip) {
                      emitFound(candidateStr, candidate, newSegments);
                      backwardCount++;
                    }
                  }
                }
                if (!anyFound) misses++;
                else misses = 0;
              }
              if (backwardCount >= pageLimit) hasMoreBackward = true;
            }
          } else {
            if (scanForward) {
              let misses = 0;
              for (
                let n = num + 1;
                forwardCount < pageLimit && misses < MAX_CONSECUTIVE_MISSES;
                n++
              ) {
                const { exists, candidateStr, candidate, newSegments } = await checkSeg(n, '');
                if (exists && candidateStr !== url.trim()) {
                  forwardFound++;
                  if (forwardFound > forwardSkip) {
                    emitFound(candidateStr, candidate, newSegments);
                    forwardCount++;
                  }
                  misses = 0;
                } else if (candidateStr !== url.trim()) {
                  misses++;
                }
              }
              if (forwardCount >= pageLimit) hasMoreForward = true;
            }
            if (scanBackward) {
              let misses = 0;
              for (
                let n = num - 1;
                n > 0 && backwardCount < pageLimit && misses < MAX_CONSECUTIVE_MISSES;
                n--
              ) {
                const { exists, candidateStr, candidate, newSegments } = await checkSeg(n, '');
                if (exists && candidateStr !== url.trim()) {
                  backwardFound++;
                  if (backwardFound > backwardSkip) {
                    emitFound(candidateStr, candidate, newSegments);
                    backwardCount++;
                  }
                  misses = 0;
                } else if (candidateStr !== url.trim()) {
                  misses++;
                }
              }
              if (backwardCount >= pageLimit) hasMoreBackward = true;
            }
          }
          send('has_more', {
            forward: hasMoreForward,
            backward: hasMoreBackward,
            forwardTotal: forwardCount + (scanForward ? skipCount : 0),
            backwardTotal: backwardCount + (scanBackward ? skipCount : 0),
          });
        }

        send('done', {});
      } catch {
        send('done', {});
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

// ---------- IIIF identifier detection ----------

interface IIIFIdentifier {
  /** Index of the identifier segment in the path */
  segmentIndex: number;
  /** The raw (percent-encoded) segment */
  rawSegment: string;
  /** Text before the number (in the decoded last component) */
  prefix: string;
  /** The page number */
  num: number;
  /** Zero-padding width */
  pad: number;
  /** Suffix after the number (e.g. '.jp2') */
  suffix: string;
  /** R/V folio suffix before the extension, if any */
  folioSuffix: string;
  /** Parts of the decoded identifier before the last component */
  identifierHead: string;
}

/**
 * Detect a IIIF Image API identifier with an embedded page number.
 *
 * IIIF URLs: {server}/{prefix}/{identifier}/{region}/{size}/{rotation}/{quality}.{format}
 *
 * The identifier may contain %2F-encoded slashes and a file extension.
 * Example: bbb%2Fbbb-Mss-hh-I0002%2Fbbb-Mss-hh-I0002_001.jp2
 *   → page number 001, prefix "bbb-Mss-hh-I0002_", suffix ".jp2"
 */
function findIIIFIdentifier(segments: string[]): IIIFIdentifier | null {
  // Look for a segment containing %2F or a IIIF-like identifier before /full/ or /square/
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]!;
    const nextSeg = segments[i + 1]?.toLowerCase();

    // IIIF region parameter follows the identifier
    if (nextSeg !== 'full' && nextSeg !== 'square' && !/^\d+,\d+,\d+,\d+$/.test(nextSeg ?? '')) {
      continue;
    }

    // Decode the identifier
    const decoded = decodeURIComponent(seg);

    // Get the last component (after the last /)
    const parts = decoded.split('/');
    const lastPart = parts[parts.length - 1] ?? '';
    const head = parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : '';

    // Match: prefix + digits + optional R/V + extension
    const match = lastPart.match(/^(.+?)(\d{2,})([RVrv])?(\.[a-z0-9]{2,4})?$/i);
    if (!match) continue;

    return {
      segmentIndex: i,
      rawSegment: seg,
      prefix: match[1]!,
      num: parseInt(match[2]!, 10),
      pad: match[2]!.length,
      suffix: match[4] ?? '',
      folioSuffix: (match[3] ?? '').toUpperCase(),
      identifierHead: head,
    };
  }
  return null;
}

interface NumericQueryParam {
  key: string;
  num: number;
}

/**
 * Find a query parameter with a numeric value (e.g. ?id=180463).
 * Returns the first parameter whose value is a pure integer.
 */
function findNumericQueryParam(parsed: URL): NumericQueryParam | null {
  for (const [key, value] of parsed.searchParams) {
    if (/^\d+$/.test(value) && value.length >= 2) {
      return { key, num: parseInt(value, 10) };
    }
  }
  return null;
}

interface PageSegment {
  index: number;
  prefix: string;
  num: number;
  pad: number;
  suffix: string; // 'R', 'V', or ''
  fileExtension?: string; // '.jpg', '.png', etc.
}

/**
 * Scan URL path segments to find one that looks like a page identifier.
 * Matches patterns like: ID0009V, f001r, page003, 0042, folio12v
 * Also matches filenames with numbers before extension: 1.jpg, page_03.png
 * Skips segments that are clearly not page IDs (full, default, 0, etc.)
 */
function findPageSegment(segments: string[]): PageSegment | null {
  const SKIP = new Set(['', 'full', 'default', 'max', 'native', 'color', 'gray', 'bitonal']);

  // First pass: try to match filename (last segment) with number before extension
  // e.g. "1.jpg" → num=1, "page_03.png" → prefix="page_", num=3
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    if (SKIP.has(seg.toLowerCase())) continue;

    const fileMatch = seg.match(/^([A-Za-z_-]*)(\d+)([RVrv])?(\.[a-z0-9]{2,4})$/i);
    if (fileMatch) {
      return {
        index: i,
        prefix: fileMatch[1]!,
        num: parseInt(fileMatch[2]!, 10),
        pad: fileMatch[2]!.length,
        suffix: (fileMatch[3] ?? '').toUpperCase(),
        fileExtension: fileMatch[4]!,
      };
    }
  }

  // Second pass: match bare numeric segments without extension
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    if (SKIP.has(seg.toLowerCase())) continue;
    // Skip pure single-digit segments (like IIIF rotation "0")
    if (/^\d$/.test(seg)) continue;
    // Skip segments with file extensions (handled in first pass)
    if (/\.[a-z]{2,4}$/i.test(seg)) continue;

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
  const sizeIndex = segments.findIndex(
    (s, i) => s === 'full' && i > 0 && segments[i - 1] === 'full',
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
