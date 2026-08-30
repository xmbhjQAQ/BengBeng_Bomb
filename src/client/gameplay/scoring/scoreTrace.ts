import type { ScorePoint } from '../../../shared/contracts';
import type { ChallengePhase } from '../challenge';

export function isScoreTraceRecordingPhase(phase: ChallengePhase) {
  return phase === 'running' || phase === 'face-grace';
}

export function scoreTraceBucketSeconds(durationSeconds: number, maxPoints: number, minimumBucketSeconds = 1) {
  return Math.max(minimumBucketSeconds, Math.ceil(Math.max(0, durationSeconds) / Math.max(1, maxPoints)));
}

export function recordScorePoint(
  points: ScorePoint[],
  input: { timeSeconds: number; smoothedScore: number; durationSeconds: number; maxPoints: number; minimumBucketSeconds?: number },
) {
  if (!Number.isFinite(input.timeSeconds) || input.timeSeconds < 0 ||
      !Number.isFinite(input.smoothedScore)) return points;
  const bucketSize = scoreTraceBucketSeconds(input.durationSeconds, input.maxPoints, input.minimumBucketSeconds);
  const roundedTime = Math.round(input.timeSeconds * 10) / 10;
  const point = Object.freeze({
    timeSeconds: input.durationSeconds > 0 ? Math.min(input.durationSeconds, roundedTime) : roundedTime,
    score: Math.round(Math.min(100, Math.max(0, input.smoothedScore))),
  });
  const bucket = Math.floor(point.timeSeconds / bucketSize);
  const last = points.at(-1);
  if (last && Math.floor(last.timeSeconds / bucketSize) === bucket) {
    points[points.length - 1] = point;
  } else if (points.length < input.maxPoints) {
    points.push(point);
  }
  return points;
}

export function freezeScoreTrace(points: readonly ScorePoint[]) {
  return Object.freeze(points.map((point) => Object.freeze({ ...point })));
}
