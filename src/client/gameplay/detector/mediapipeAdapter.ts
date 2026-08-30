import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { DemoConfig } from '../app/config';
import { faceLandmarkerModelUrl, mediapipeWasmDirectory } from './assetPaths';
import type { DetectionResult, FaceDetector, FaceObservation } from './types';

type VisionFileset = Parameters<typeof FaceLandmarker.createFromOptions>[0];

let initializationTail: Promise<void> = Promise.resolve();

const sanitizeError = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/\b(?:https?|file|blob):\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:token|key|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
    .replace(/(?:\.{0,2}\/|[A-Z]:\\)(?:vendor|api|c)[/\\][^\s"'<>]+/gi, '[path]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240) || '未知错误';
};

export class DetectorInitializationError extends Error {
  readonly code = 'MEDIAPIPE_INITIALIZATION_FAILED';

  constructor(automaticError: unknown, noSimdError: unknown) {
    super(
      `MediaPipe 初始化失败（自动 SIMD：${sanitizeError(automaticError)}；` +
      `无 SIMD：${sanitizeError(noSimdError)}）`,
    );
    this.name = 'DetectorInitializationError';
  }
}

export const detectorErrorMessage = (error: unknown) =>
  error instanceof DetectorInitializationError
    ? error.message
    : `MediaPipe 初始化失败：${sanitizeError(error)}`;

const category = (result: FaceLandmarkerResult, face: number, name: string) => {
  const score = result.faceBlendshapes[face]?.categories.find(
    (item) => item.categoryName === name,
  )?.score;
  return score === undefined || !Number.isFinite(score)
    ? null
    : Math.min(1, Math.max(0, score));
};

const average = (left: number, right: number) => (left + right) / 2;
const distance = (left?: { x: number; y: number }, right?: { x: number; y: number }) =>
  left &&
  right &&
  Number.isFinite(left.x) &&
  Number.isFinite(left.y) &&
  Number.isFinite(right.x) &&
  Number.isFinite(right.y)
    ? Math.hypot(left.x - right.x, left.y - right.y)
    : null;

const invalidObservation = (timestamp: number, faceCount: number): FaceObservation => ({
  timestamp,
  faceCount,
  confidence: 0,
  yaw: 0,
  roll: 0,
});

export function toObservation(result: FaceLandmarkerResult, timestamp: number): FaceObservation {
  const faceCount = result.faceLandmarks.length;
  if (faceCount !== 1) return invalidObservation(timestamp, faceCount);

  const landmarks = result.faceLandmarks[0];
  const leftEye = landmarks?.[33];
  const rightEye = landmarks?.[263];
  const nose = landmarks?.[1];
  const eyeDistance = distance(leftEye, rightEye);
  const mouthWidth = distance(landmarks?.[61], landmarks?.[291]);
  const smileLeft = category(result, 0, 'mouthSmileLeft');
  const smileRight = category(result, 0, 'mouthSmileRight');
  const cheekLeft = category(result, 0, 'cheekSquintLeft');
  const cheekRight = category(result, 0, 'cheekSquintRight');
  const mouthOpen = category(result, 0, 'jawOpen');
  if (
    !nose ||
    !Number.isFinite(nose.x) ||
    !eyeDistance ||
    !mouthWidth ||
    smileLeft === null ||
    smileRight === null ||
    cheekLeft === null ||
    cheekRight === null ||
    mouthOpen === null
  ) {
    return invalidObservation(timestamp, faceCount);
  }
  const eyeMidX = leftEye && rightEye ? (leftEye.x + rightEye.x) / 2 : 0;
  const roll =
    leftEye && rightEye
      ? (Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * 180) / Math.PI
      : 0;
  const yaw = ((nose.x - eyeMidX) / eyeDistance) * 75;
  const mouthWidthRatio = mouthWidth / eyeDistance;

  // The task result does not expose internal face-presence confidence. Landmark
  // completeness stays adapter-local as a coarse validity proxy.
  const confidence = Math.min(1, (landmarks?.length ?? 0) / 478);
  return {
    timestamp,
    faceCount,
    confidence,
    yaw,
    roll,
    features: {
      smile: average(
        smileLeft,
        smileRight,
      ),
      cheekSquint: average(
        cheekLeft,
        cheekRight,
      ),
      mouthOpen,
      mouthWidthRatio,
    },
  };
}

async function createLandmarkerWithFileset(
  config: DemoConfig['detector'],
  vision: VisionFileset,
) {
  const options = {
    runningMode: 'VIDEO' as const,
    numFaces: config.maxFaces,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
    minFaceDetectionConfidence: config.minDetectionConfidence,
    minFacePresenceConfidence: config.minPresenceConfidence,
    minTrackingConfidence: config.minTrackingConfidence,
  };
  try {
    return await FaceLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: faceLandmarkerModelUrl(), delegate: 'GPU' },
    });
  } catch {
    return FaceLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: faceLandmarkerModelUrl(), delegate: 'CPU' },
    });
  }
}

const noSimdFileset = (): VisionFileset => {
  const directory = mediapipeWasmDirectory();
  return {
    wasmLoaderPath: `${directory}/vision_wasm_nosimd_internal.js`,
    wasmBinaryPath: `${directory}/vision_wasm_nosimd_internal.wasm`,
  };
};

async function createLandmarker(config: DemoConfig['detector']) {
  let automaticError: unknown;
  try {
    const automaticFileset = await FilesetResolver.forVisionTasks(mediapipeWasmDirectory());
    return await createLandmarkerWithFileset(config, automaticFileset);
  } catch (error) {
    automaticError = error;
  }

  try {
    return await createLandmarkerWithFileset(config, noSimdFileset());
  } catch (noSimdError) {
    throw new DetectorInitializationError(automaticError, noSimdError);
  }
}

function enqueueInitialization<T>(initialize: () => Promise<T>): Promise<T> {
  const pending = initializationTail.then(initialize, initialize);
  initializationTail = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

export async function createFaceDetector(config: DemoConfig['detector']): Promise<FaceDetector> {
  return enqueueInitialization(async () => {
    const landmarker = await createLandmarker(config);
    return {
      detect(video, timestamp): DetectionResult {
        const started = performance.now();
        const result = landmarker.detectForVideo(video, timestamp);
        return {
          observation: toObservation(result, timestamp),
          inferenceMs: performance.now() - started,
        };
      },
      close: () => landmarker.close(),
    };
  });
}
