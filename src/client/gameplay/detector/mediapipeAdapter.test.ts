import type {
  Category,
  FaceLandmarkerResult,
  NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import { describe, expect, it } from 'vitest';
import { toObservation } from './mediapipeAdapter';

const blendshape = (categoryName: string, score: number, index: number): Category => ({
  categoryName,
  displayName: '',
  index,
  score,
});

const result = (categories: Category[]): FaceLandmarkerResult => {
  const landmarks: NormalizedLandmark[] = Array.from({ length: 478 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  landmarks[33] = { x: 0.3, y: 0.4, z: 0, visibility: 1 };
  landmarks[263] = { x: 0.7, y: 0.4, z: 0, visibility: 1 };
  landmarks[1] = { x: 0.5, y: 0.5, z: 0, visibility: 1 };
  landmarks[61] = { x: 0.4, y: 0.6, z: 0, visibility: 1 };
  landmarks[291] = { x: 0.6, y: 0.6, z: 0, visibility: 1 };
  return {
    faceLandmarks: [landmarks],
    faceBlendshapes: [{ categories, headIndex: 0, headName: '' }],
    facialTransformationMatrixes: [],
  };
};

const completeCategories = () => [
  blendshape('mouthSmileLeft', 0.4, 0),
  blendshape('mouthSmileRight', 0.6, 1),
  blendshape('cheekSquintLeft', 0.2, 2),
  blendshape('cheekSquintRight', 0.4, 3),
  blendshape('jawOpen', 0.1, 4),
];

describe('MediaPipe result conversion', () => {
  it('converts complete model output into bounded application features', () => {
    const observation = toObservation(result(completeCategories()), 100);
    expect(observation.confidence).toBe(1);
    expect(observation.features?.smile).toBeCloseTo(0.5);
    expect(observation.features?.cheekSquint).toBeCloseTo(0.3);
    expect(observation.features?.mouthOpen).toBeCloseTo(0.1);
  });

  it('marks incomplete or non-finite blendshape output invalid instead of treating it as neutral', () => {
    const missing = toObservation(result(completeCategories().slice(0, 4)), 100);
    const nonFinite = completeCategories();
    nonFinite[0] = blendshape('mouthSmileLeft', Number.NaN, 0);

    expect(missing.features).toBeUndefined();
    expect(missing.confidence).toBe(0);
    expect(toObservation(result(nonFinite), 100).features).toBeUndefined();
  });
});
