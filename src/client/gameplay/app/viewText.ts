import type { CameraStatus } from '../camera';
import type { ChallengePhase, InvalidationReason } from '../challenge';
import type { DetectorStatus, FaceInvalidReason } from '../detector';
import { t } from '../i18n';

export const cameraStatusText = (status: CameraStatus) => ({
  idle: t.camera.idle,
  requesting: t.camera.requesting,
  ready: t.camera.ready,
  denied: t.camera.denied,
  'insecure-context': t.camera.insecureContext,
  unavailable: t.camera.unavailable,
  interrupted: t.camera.interrupted,
  unsupported: t.camera.unsupported,
})[status];

export const detectorStatusText = (status: DetectorStatus) => ({
  idle: t.camera.idle,
  loading: t.camera.modelLoading,
  ready: t.camera.detectorReady,
  error: t.camera.modelError,
})[status];

export const faceValidityText = (validity: FaceInvalidReason | 'waiting') => ({
  none: t.metrics.valid,
  'no-face': t.metrics.noFace,
  'multiple-faces': t.metrics.multipleFaces,
  'low-confidence': t.metrics.lowConfidence,
  pose: t.metrics.pose,
  waiting: t.metrics.waiting,
})[validity];

export const phaseText = (phase: ChallengePhase) => ({
  selecting: t.phase.selecting,
  preparing: t.phase.preparing,
  calibrating: t.phase.calibrating,
  ready: t.phase.ready,
  running: t.phase.running,
  'face-grace': t.phase.faceGrace,
  'face-paused': t.phase.facePaused,
  'resume-stabilizing': t.phase.resumeStabilizing,
  'resume-countdown': t.phase.resumeCountdown,
  buffering: t.phase.buffering,
  failed: t.phase.failed,
  completed: t.phase.completed,
  invalid: t.phase.invalid,
})[phase];

export const invalidReasonText = (reason: InvalidationReason | null) => ({
  'unexpected-pause': t.invalidReason.unexpectedPause,
  'user-seek': t.invalidReason.userSeek,
  'rate-changed': t.invalidReason.rateChanged,
  'video-error': t.invalidReason.videoError,
  'play-rejected': t.invalidReason.playRejected,
  'camera-interrupted': t.invalidReason.cameraInterrupted,
  'detector-error': t.invalidReason.detectorError,
  'page-hidden': t.invalidReason.pageHidden,
})[reason ?? 'video-error'];
