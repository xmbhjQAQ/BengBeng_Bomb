import { describe, expect, it } from 'vitest';
import { createLocalResult } from './createResult';

describe('createLocalResult', () => {
  it('creates a frozen privacy-safe result snapshot', () => {
    const result = createLocalResult({
      settlement: {
        outcome: 'failed',
        failedAt: 2,
        videoPositionSeconds: 2,
        videoDurationSeconds: 10,
        validElapsedMs: 1_900,
      },
      videoName: 'demo.mp4',
      maximumSmoothedScore: 81,
      profile: {
        schemaVersion: 1,
        sampleCount: 30,
        baseline: 0.05,
        deviation: 0.01,
        quality: 'good',
      },
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(result.failedAt).toBe(2);
    expect(Object.keys(result).sort()).toEqual([
      'calibrationQuality',
      'calibrationSampleCount',
      'failedAt',
      'maximumSmoothedScore',
      'outcome',
      'schemaVersion',
      'validElapsedMs',
      'videoDurationSeconds',
      'videoName',
      'videoPositionSeconds',
    ]);
  });
});
