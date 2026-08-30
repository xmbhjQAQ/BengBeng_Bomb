import type { CalibrationProfile } from '../calibration';
import type { ChallengeSettlement } from '../challenge';
import type { LocalChallengeResult } from './types';
import type { ScorePoint } from '../../../shared/contracts';

interface ResultInput {
  settlement: ChallengeSettlement;
  videoName: string;
  maximumSmoothedScore: number;
  profile: CalibrationProfile;
  scoreTrace: ReadonlyArray<Readonly<ScorePoint>>;
}

export function createLocalResult(input: ResultInput): LocalChallengeResult {
  return Object.freeze({
    schemaVersion: 2,
    outcome: input.settlement.outcome,
    videoName: input.videoName,
    failedAt: input.settlement.outcome === 'failed'
      ? (input.settlement.failedAt ?? input.settlement.videoPositionSeconds)
      : null,
    videoPositionSeconds: input.settlement.videoPositionSeconds,
    videoDurationSeconds: input.settlement.videoDurationSeconds,
    validElapsedMs: input.settlement.validElapsedMs,
    maximumSmoothedScore: input.maximumSmoothedScore,
    calibrationSampleCount: input.profile.sampleCount,
    calibrationQuality: 'good',
    scoreTrace: Object.freeze(input.scoreTrace.map((point) => Object.freeze({ ...point }))),
  });
}
