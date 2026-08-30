import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { DemoConfig } from '../app/config';
import { faceLandmarkerModelUrl, mediapipeWasmDirectory } from './assetPaths';
import type { DetectionResult, FaceDetector, FaceObservation } from './types';

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

async function createLandmarker(config: DemoConfig['detector']) {
  const vision = await FilesetResolver.forVisionTasks(mediapipeWasmDirectory());
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

export async function createFaceDetector(config: DemoConfig['detector']): Promise<FaceDetector> {
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
}
