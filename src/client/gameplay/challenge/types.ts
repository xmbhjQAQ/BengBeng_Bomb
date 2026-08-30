import type { ChallengeOutcome } from '../result';

export type RecoverablePhase =
  | 'running'
  | 'face-grace'
  | 'face-paused'
  | 'resume-stabilizing'
  | 'resume-countdown';

export type ChallengePhase =
  | 'selecting'
  | 'preparing'
  | 'calibrating'
  | 'ready'
  | RecoverablePhase
  | 'buffering'
  | 'failed'
  | 'completed'
  | 'invalid';

export type InvalidationReason =
  | 'unexpected-pause'
  | 'user-seek'
  | 'rate-changed'
  | 'video-error'
  | 'play-rejected'
  | 'camera-interrupted'
  | 'detector-error'
  | 'page-hidden';

export interface ChallengeSettlement {
  outcome: ChallengeOutcome;
  /** The exact media currentTime captured at the failure event, when failed. */
  failedAt?: number;
  videoPositionSeconds: number;
  videoDurationSeconds: number;
  validElapsedMs: number;
}

export interface ChallengeState {
  phase: ChallengePhase;
  validElapsedMs: number;
  activeSince: number | null;
  faceInvalidSince: number | null;
  faceValidSince: number | null;
  countdownEndsAt: number | null;
  bufferStartedAt: number | null;
  phaseBeforeBuffering: RecoverablePhase | null;
  settlement: ChallengeSettlement | null;
  invalidReason: InvalidationReason | null;
}

export type ChallengeEvent =
  | { type: 'VIDEO_SELECTED' }
  | { type: 'CALIBRATION_STARTED' }
  | { type: 'CALIBRATION_READY' }
  | { type: 'CALIBRATION_FAILED' }
  | { type: 'STARTED'; now: number }
  | { type: 'FACE_INVALID'; now: number }
  | { type: 'FACE_VALID'; now: number }
  | { type: 'TICK'; now: number }
  | { type: 'MEDIA_WAITING'; now: number }
  | { type: 'MEDIA_PLAYING'; now: number }
  | { type: 'SMILE_FAILED'; now: number; position: number; duration: number }
  | { type: 'VIDEO_ENDED'; now: number; position: number; duration: number }
  | { type: 'INVALIDATE'; now: number; reason: InvalidationReason }
  | { type: 'RESTART' };

export type ChallengeCommand = 'pause-video' | 'play-video' | 'reset-video';
export interface Transition {
  state: ChallengeState;
  commands: ChallengeCommand[];
}
