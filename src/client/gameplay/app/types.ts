import type { PlaybackData } from '../../../shared/contracts';
import type { BilibiliVideoData, DanmakuStatus } from '../bilibili';
import type { CalibrationProfile } from '../calibration';
import type { CameraStatus } from '../camera';
import type { ChallengePhase, InvalidationReason } from '../challenge';
import type { DetectorStatus, FaceInvalidReason } from '../detector';
import type { LocalChallengeResult } from '../result';
import type { SmileSample } from '../scoring';

export interface LiveMetrics {
  faceValidity: FaceInvalidReason | 'waiting';
  rawSignal: number | null;
  smoothedScore: number | null;
  videoTimeSeconds: number | null;
  inferenceMs: number;
  effectiveFps: number;
  skippedFrames: number;
}

export interface SmileDemoController {
  cameraStatus: CameraStatus;
  detectorStatus: DetectorStatus;
  phase: ChallengePhase;
  invalidReason: InvalidationReason | null;
  bilibiliSelection: BilibiliVideoData | null;
  sourceLoading: boolean;
  sourceError: string | null;
  playerError: string | null;
  danmakuStatus: DanmakuStatus;
  videoReady: boolean;
  profile: CalibrationProfile | null;
  calibrationIssue: CalibrationProfile['quality'] | null;
  calibrationProgress: number;
  sample: SmileSample | null;
  metrics: LiveMetrics;
  result: LocalChallengeResult | null;
  countdownSeconds: number | null;
  canCalibrate: boolean;
  canStart: boolean;
  selectBilibili(input: string): Promise<void>;
  selectResolvedBilibili(playback: PlaybackData): void;
  openCamera(): void;
  closeCamera(): void;
  retryDetector(): void;
  startCalibration(): void;
  startChallenge(): void;
  restart(): void;
  setPlayerContainer(element: HTMLDivElement | null): void;
  setCameraElement(element: HTMLVideoElement | null): void;
  onVideoPause(): void;
  onVideoSeeking(): void;
  onVideoRateChange(): void;
  onVideoWaiting(): void;
  onVideoPlaying(): void;
  onVideoEnded(): void;
  onVideoError(): void;
}
