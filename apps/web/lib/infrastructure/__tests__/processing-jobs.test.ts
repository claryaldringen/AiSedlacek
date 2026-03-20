import { describe, it, expect, beforeEach } from 'vitest';
import {
  createJob,
  pauseJob,
  resumeJob,
  isJobPaused,
  cancelJob,
  getActiveJob,
  completeJob,
} from '../processing-jobs';

describe('pause/resume', () => {
  const userId = 'test-user';

  beforeEach(() => {
    const job = getActiveJob(userId);
    if (job && !job.completed) {
      cancelJob(userId);
    }
    completeJob(userId);
  });

  it('pauseJob sets paused state and creates promise', () => {
    createJob(userId, ['p1']);
    expect(isJobPaused(userId)).toBe(false);
    expect(pauseJob(userId)).toBe(true);
    expect(isJobPaused(userId)).toBe(true);
  });

  it('resumeJob clears paused state and resolves promise', async () => {
    createJob(userId, ['p1']);
    pauseJob(userId);
    const job = getActiveJob(userId)!;
    let resolved = false;
    void job.pausePromise!.then(() => {
      resolved = true;
    });
    resumeJob(userId);
    await Promise.resolve();
    expect(isJobPaused(userId)).toBe(false);
    expect(resolved).toBe(true);
  });

  it('pauseJob returns false if no active job', () => {
    expect(pauseJob('nonexistent')).toBe(false);
  });

  it('cancelJob resolves pausePromise so loop unblocks', async () => {
    createJob(userId, ['p1']);
    pauseJob(userId);
    const job = getActiveJob(userId)!;
    let resolved = false;
    void job.pausePromise!.then(() => {
      resolved = true;
    });
    cancelJob(userId);
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it('pauseJob on completed job returns false', () => {
    createJob(userId, ['p1']);
    completeJob(userId);
    expect(pauseJob(userId)).toBe(false);
  });
});
