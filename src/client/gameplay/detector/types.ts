export type FaceInvalidReason =
  | 'none'
  | 'no-face'
  | 'multiple-faces'
  | 'low-confidence'
  | 'pose';

export interface FaceFeatures {
  smile: number;
  cheekSquint: number;
  mouthOpen: number;
  mouthWidthRatio: number;
}

export interface FaceObservation {
  timestamp: number;
  faceCount: number;
  confidence: number;
  yaw: number;
  roll: number;
  features?: FaceFeatures;
}

export interface DetectionResult {
  observation: FaceObservation;
  inferenceMs: number;
}

export interface FaceDetector {
  detect(video: HTMLVideoElement, timestamp: number): DetectionResult;
  close(): void;
}

export type DetectorStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SkippedFrameReason = 'busy' | 'video-not-ready';
export type InferenceTermination = { reason: 'detection-error'; error: unknown };

export interface InferenceLoopHandlers {
  onResult: (result: DetectionResult) => void;
  onSkippedFrame?: (reason: SkippedFrameReason) => void;
  onTerminated: (termination: InferenceTermination) => void;
}
