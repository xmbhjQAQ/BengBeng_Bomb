export type ChallengeOutcome = 'failed' | 'completed';

export interface LocalChallengeResult {
  readonly schemaVersion: 1;
  readonly outcome: ChallengeOutcome;
  readonly videoName: string;
  readonly failedAt: number | null;
  readonly videoPositionSeconds: number;
  readonly videoDurationSeconds: number;
  readonly validElapsedMs: number;
  readonly maximumSmoothedScore: number;
  readonly calibrationSampleCount: number;
  readonly calibrationQuality: 'good';
}
