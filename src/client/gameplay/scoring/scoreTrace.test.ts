import { describe, expect, it } from 'vitest';
import { freezeScoreTrace, isScoreTraceRecordingPhase, recordScorePoint, scoreTraceBucketSeconds } from './scoreTrace';

describe('score trace capture', () => {
  it('uses at least one-second buckets and keeps the newest valid point per bucket', () => {
    const points: Array<{ timeSeconds: number; score: number }> = [];
    recordScorePoint(points, { timeSeconds: .1, smoothedScore: 10.4, durationSeconds: 20, maxPoints: 600 });
    recordScorePoint(points, { timeSeconds: .9, smoothedScore: 31.8, durationSeconds: 20, maxPoints: 600 });
    recordScorePoint(points, { timeSeconds: 1.1, smoothedScore: 120, durationSeconds: 20, maxPoints: 600 });
    expect(points).toEqual([{ timeSeconds: .9, score: 32 }, { timeSeconds: 1.1, score: 100 }]);
  });

  it('widens buckets for long videos and never exceeds the configured cap', () => {
    expect(scoreTraceBucketSeconds(7_200, 600)).toBe(12);
    const points: Array<{ timeSeconds: number; score: number }> = [];
    for (let timeSeconds=0; timeSeconds<7_200; timeSeconds+=.5) recordScorePoint(points, { timeSeconds, smoothedScore: timeSeconds%100, durationSeconds: 7_200, maxPoints: 600 });
    expect(points).toHaveLength(600);
  });

  it('returns a deeply frozen retry-safe snapshot', () => {
    const frozen = freezeScoreTrace([{ timeSeconds: 1, score: 42 }]);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen[0])).toBe(true);
  });

  it('records only while playback is advancing, not during paused recovery phases', () => {
    expect(isScoreTraceRecordingPhase('running')).toBe(true);
    expect(isScoreTraceRecordingPhase('face-grace')).toBe(true);
    expect(isScoreTraceRecordingPhase('face-paused')).toBe(false);
    expect(isScoreTraceRecordingPhase('resume-stabilizing')).toBe(false);
    expect(isScoreTraceRecordingPhase('resume-countdown')).toBe(false);
    expect(isScoreTraceRecordingPhase('buffering')).toBe(false);
  });
});
