import type { DemoConfig } from '../app/config';
import type { FaceFeatures, FaceInvalidReason, FaceObservation } from '../detector';

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

export function composeSmileSignal(features: FaceFeatures): number {
  const mouthShape = Math.max(0, features.mouthWidthRatio - 0.45) * 0.65;
  const openPenalty = Math.max(0, features.mouthOpen - 0.45) * 0.2;
  return clamp(
    features.smile * 0.68 + features.cheekSquint * 0.22 + mouthShape - openPenalty,
    0,
    1,
  );
}

export function observationValidity(
  observation: FaceObservation,
  parameters: DemoConfig['scoring'],
): FaceInvalidReason {
  if (observation.faceCount === 0) return 'no-face';
  if (observation.faceCount > 1) return 'multiple-faces';
  if (!observation.features || observation.confidence < parameters.minConfidence) {
    return 'low-confidence';
  }
  if (
    Math.abs(observation.yaw) > parameters.maxPoseDegrees ||
    Math.abs(observation.roll) > parameters.maxPoseDegrees
  ) {
    return 'pose';
  }
  return 'none';
}

export function normalizedScore(rawSignal: number, baseline: number, sensitivity: number) {
  return clamp(Math.max(0, rawSignal - baseline) * sensitivity * 100);
}
