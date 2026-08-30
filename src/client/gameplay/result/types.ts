import type { ScorePoint } from '../../../shared/contracts';

export type ChallengeOutcome = 'failed' | 'completed';

export interface LocalChallengeResult {
  readonly schemaVersion: 2;
  readonly outcome: ChallengeOutcome;
  readonly videoName: string;
  readonly failedAt: number | null;
  readonly videoPositionSeconds: number;
  readonly videoDurationSeconds: number;
  readonly validElapsedMs: number;
  readonly maximumSmoothedScore: number;
  readonly calibrationSampleCount: number;
  readonly calibrationQuality: 'good';
  readonly scoreTrace: ReadonlyArray<Readonly<ScorePoint>>;
}
