import type { FaceInvalidReason } from '../detector';

export type SmileClassification = 'neutral' | 'danger' | 'failed';

export interface SmileSample {
  timestamp: number;
  valid: boolean;
  invalidReason: FaceInvalidReason;
  rawSignal: number | null;
  score: number | null;
  smoothedScore: number | null;
  thresholdElapsedMs: number;
  classification: SmileClassification;
}

export interface ScoringState {
  smoothedScore: number;
  lastValidTimestamp: number | null;
  aboveThresholdSince: number | null;
  classification: SmileClassification;
}
