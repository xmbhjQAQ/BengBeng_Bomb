import { CLIENT_CONFIG } from '../../../shared/config/client';

export interface DemoConfig {
  bilibili: {
    apiBaseUrl: string;
    apiKey: string;
    page: number;
    qn: number;
  };
  camera: { width: number; height: number };
  detector: {
    targetFps: number;
    maxFaces: number;
    minDetectionConfidence: number;
    minPresenceConfidence: number;
    minTrackingConfidence: number;
  };
  calibration: {
    durationMs: number;
    minimumSamples: number;
    maximumDeviation: number;
  };
  scoring: {
    dangerThreshold: number;
    failureThreshold: number;
    releaseThreshold: number;
    sustainedMs: number;
    smoothingAlpha: number;
    sensitivity: number;
    minConfidence: number;
    maxPoseDegrees: number;
  };
  challenge: {
    faceGraceMs: number;
    recoveryStableMs: number;
    resumeCountdownMs: number;
  };
  video: { metadataTimeoutMs: number };
  scoreTrace: { maxPoints: number; minimumBucketSeconds: number };
}

export const DEMO_CONFIG: Readonly<DemoConfig> = {
  bilibili: {
    apiBaseUrl: '',
    apiKey: '',
    page: 1,
    qn: 80,
  },
  camera: CLIENT_CONFIG.camera,
  detector: CLIENT_CONFIG.detector,
  calibration: CLIENT_CONFIG.calibration,
  scoring: CLIENT_CONFIG.scoring,
  challenge: CLIENT_CONFIG.challenge,
  video: CLIENT_CONFIG.video,
  scoreTrace: CLIENT_CONFIG.scoreTrace,
};

export function normalizedConfig(value: DemoConfig): DemoConfig {
  const failureThreshold = clamp(value.scoring.failureThreshold, 0, 100);
  const dangerThreshold = clamp(value.scoring.dangerThreshold, 0, failureThreshold);
  const releaseThreshold = clamp(value.scoring.releaseThreshold, 0, dangerThreshold);
  return {
    ...value,
    bilibili: {
      apiBaseUrl: String(value.bilibili.apiBaseUrl || DEMO_CONFIG.bilibili.apiBaseUrl),
      apiKey: String(value.bilibili.apiKey || ''),
      page: positiveInteger(value.bilibili.page),
      qn: positiveInteger(value.bilibili.qn),
    },
    camera: {
      width: positiveInteger(value.camera.width),
      height: positiveInteger(value.camera.height),
    },
    detector: {
      ...value.detector,
      targetFps: positive(value.detector.targetFps),
      maxFaces: Math.max(2, positiveInteger(value.detector.maxFaces)),
      minDetectionConfidence: clamp(value.detector.minDetectionConfidence, 0, 1),
      minPresenceConfidence: clamp(value.detector.minPresenceConfidence, 0, 1),
      minTrackingConfidence: clamp(value.detector.minTrackingConfidence, 0, 1),
    },
    calibration: {
      durationMs: Math.max(250, finite(value.calibration.durationMs)),
      minimumSamples: positiveInteger(value.calibration.minimumSamples),
      maximumDeviation: Math.max(0, finite(value.calibration.maximumDeviation)),
    },
    scoring: {
      ...value.scoring,
      releaseThreshold,
      dangerThreshold,
      failureThreshold,
      sustainedMs: Math.max(0, finite(value.scoring.sustainedMs)),
      smoothingAlpha: clamp(value.scoring.smoothingAlpha, 0, 1),
      sensitivity: Math.max(0.1, finite(value.scoring.sensitivity)),
      minConfidence: clamp(value.scoring.minConfidence, 0, 1),
      maxPoseDegrees: clamp(value.scoring.maxPoseDegrees, 0, 180),
    },
    challenge: {
      faceGraceMs: Math.max(0, finite(value.challenge.faceGraceMs)),
      recoveryStableMs: Math.max(0, finite(value.challenge.recoveryStableMs)),
      resumeCountdownMs: Math.max(0, finite(value.challenge.resumeCountdownMs)),
    },
    video: { metadataTimeoutMs: Math.max(500, finite(value.video.metadataTimeoutMs)) },
  };
}

export async function loadBilibiliRuntimeConfig() { return { ...DEMO_CONFIG.bilibili }; }

const finite = (value: number) => Number.isFinite(value) ? value : 0;
const positive = (value: number) => Math.max(1, finite(value));
const positiveInteger = (value: number) => Math.max(1, Math.round(finite(value)));
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, finite(value)));
