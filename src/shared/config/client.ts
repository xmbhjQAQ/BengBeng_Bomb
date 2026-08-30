export const CLIENT_CONFIG = {
  limits: { nickname: 20, recipient: 20, message: 80, title: 120, description: 180 },
  camera: { width: 640, height: 480 },
  detector: { targetFps: 15, maxFaces: 2, minDetectionConfidence: 0.55, minPresenceConfidence: 0.55, minTrackingConfidence: 0.55 },
  calibration: { durationMs: 3_000, minimumSamples: 20, maximumDeviation: 0.075 },
  scoring: { dangerThreshold: 42, failureThreshold: 68, releaseThreshold: 32, sustainedMs: 700, smoothingAlpha: 0.24, sensitivity: 2.3, minConfidence: 0.55, maxPoseDegrees: 27 },
  challenge: { faceGraceMs: 500, recoveryStableMs: 1_000, resumeCountdownMs: 3_000 },
  video: { metadataTimeoutMs: 10_000 },
  heatmapBucketSeconds: 10,
  assets: { model: '/vendor/mediapipe/models/face_landmarker.task', wasm: '/vendor/mediapipe/wasm' },
} as const;
