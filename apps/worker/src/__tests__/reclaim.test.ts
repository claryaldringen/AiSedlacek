import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    processingJob: { findMany: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    page: { updateMany: vi.fn() },
  },
}));

vi.mock('@ai-sedlacek/db', () => ({ prisma: mocks.prisma }));

import {
  reclaimStuckJobs,
  countReclaims,
  errorsKeepingReclaimMarkers,
  MAX_RECLAIMS,
  RECLAIM_MARKER,
} from '../lib/reclaim';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.processingJob.update.mockResolvedValue({});
  mocks.prisma.page.updateMany.mockResolvedValue({ count: 0 });
});

describe('reclaimStuckJobs (PERF-1)', () => {
  it('vrátí osiřelý job do fronty a zapíše značku pokusu', async () => {
    mocks.prisma.processingJob.findMany.mockResolvedValue([
      { id: 'job-1', pageIds: ['p1', 'p2'], errors: [] },
    ]);

    await reclaimStuckJobs(true);

    expect(mocks.prisma.processingJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status: 'queued',
        errors: { push: `${RECLAIM_MARKER} (obnova 1/${MAX_RECLAIMS})` },
      }),
    });
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['p1', 'p2'] }, status: 'processing' },
      data: { status: 'pending', errorMessage: null },
    });
    // Stránka s dokumentem (přerušená regenerace) se vrací do done, ne pending
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['p1', 'p2'] }, status: 'processing', document: { isNot: null } },
      data: { status: 'done', errorMessage: null },
    });
  });

  it('job opakovaně shazující worker už znovu nespustí, ale označí jako chybný', async () => {
    const errors = Array.from(
      { length: MAX_RECLAIMS },
      (_, i) => `${RECLAIM_MARKER} (obnova ${i + 1}/${MAX_RECLAIMS})`,
    );
    mocks.prisma.processingJob.findMany.mockResolvedValue([
      { id: 'job-oom', pageIds: ['p1'], errors },
    ]);

    await reclaimStuckJobs(true);

    expect(mocks.prisma.processingJob.update).toHaveBeenCalledTimes(1);
    const { where, data } = mocks.prisma.processingJob.update.mock.calls[0]![0];
    expect(where).toEqual({ id: 'job-oom' });
    expect(data.status).toBe('error');
    expect(data.errors.push).toMatch(/přerušeno pádem workeru/);
    // Stránky se i tak vrátí z `processing`, aby šly zpracovat znovu
    expect(mocks.prisma.page.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['p1'] }, status: 'processing' },
      data: { status: 'pending', errorMessage: null },
    });
  });

  it('bez osiřelých jobů nic nemění', async () => {
    mocks.prisma.processingJob.findMany.mockResolvedValue([]);
    await reclaimStuckJobs(false);
    expect(mocks.prisma.processingJob.update).not.toHaveBeenCalled();
    expect(mocks.prisma.page.updateMany).not.toHaveBeenCalled();
  });

  it('countReclaims počítá jen značky reclaimu, ne ostatní chyby', () => {
    expect(countReclaims(['Stránka p1: chyba', `${RECLAIM_MARKER} (obnova 1/2)`])).toBe(1);
    expect(countReclaims([])).toBe(0);
  });
});

describe('errorsKeepingReclaimMarkers', () => {
  it('k novým chybám přidá značky reclaimu z DB, ostatní staré chyby zahodí', async () => {
    const marker = `${RECLAIM_MARKER} (obnova 1/${MAX_RECLAIMS})`;
    mocks.prisma.processingJob.findUnique.mockResolvedValue({
      errors: [marker, 'Stránka p1: stará chyba'],
    });

    const errors = await errorsKeepingReclaimMarkers('job-1', ['Stránka p2: nová chyba']);

    expect(errors).toEqual([marker, 'Stránka p2: nová chyba']);
    expect(countReclaims(errors)).toBe(1);
    expect(mocks.prisma.processingJob.findUnique).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      select: { errors: true },
    });
  });

  it('bez jobu nebo značek vrátí jen nové chyby', async () => {
    mocks.prisma.processingJob.findUnique.mockResolvedValue(null);
    expect(await errorsKeepingReclaimMarkers('job-x', ['a'])).toEqual(['a']);
  });
});
