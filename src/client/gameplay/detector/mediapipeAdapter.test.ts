import type {
  Category,
  FaceLandmarkerResult,
  NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_CONFIG } from '../app/config';
import {
  createFaceDetector,
  DetectorInitializationError,
  detectorErrorMessage,
  toObservation,
} from './mediapipeAdapter';

const mediapipe = vi.hoisted(() => ({
  forVisionTasks: vi.fn(),
  createFromOptions: vi.fn(),
}));

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: mediapipe.forVisionTasks },
  FaceLandmarker: { createFromOptions: mediapipe.createFromOptions },
}));

const fakeLandmarker = () => ({
  close: vi.fn(),
  detectForVideo: vi.fn(),
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
};

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

describe('MediaPipe initialization', () => {
  beforeEach(() => {
    mediapipe.forVisionTasks.mockReset();
    mediapipe.createFromOptions.mockReset();
    mediapipe.forVisionTasks.mockResolvedValue({
      wasmLoaderPath: '/wasm/vision_wasm_internal.js',
      wasmBinaryPath: '/wasm/vision_wasm_internal.wasm',
    });
  });

  it('falls back from the automatic SIMD fileset to local nosimd assets', async () => {
    const landmarker = fakeLandmarker();
    mediapipe.createFromOptions
      .mockRejectedValueOnce(new Error('SIMD runtime failed'))
      .mockRejectedValueOnce(new Error('SIMD runtime failed'))
      .mockResolvedValueOnce(landmarker);

    const detector = await createFaceDetector(DEMO_CONFIG.detector);

    expect(mediapipe.createFromOptions).toHaveBeenCalledTimes(3);
    expect(mediapipe.createFromOptions.mock.calls.slice(0, 2)
      .map((call) => call[1].baseOptions.delegate)).toEqual(['GPU', 'CPU']);
    expect(mediapipe.createFromOptions.mock.calls[0]?.[0])
      .toBe(mediapipe.createFromOptions.mock.calls[1]?.[0]);
    expect(mediapipe.createFromOptions.mock.calls[2]?.[0]).toEqual({
      wasmLoaderPath: expect.stringContaining('/vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js'),
      wasmBinaryPath: expect.stringContaining('/vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm'),
    });
    expect(mediapipe.createFromOptions.mock.calls[2]?.[1].baseOptions.delegate).toBe('GPU');
    detector.close();
    expect(landmarker.close).toHaveBeenCalledOnce();
  });

  it('keeps the GPU to CPU delegate fallback before changing filesets', async () => {
    const landmarker = fakeLandmarker();
    mediapipe.createFromOptions
      .mockRejectedValueOnce(new Error('WebGL unavailable'))
      .mockResolvedValueOnce(landmarker);

    await createFaceDetector(DEMO_CONFIG.detector);

    expect(mediapipe.createFromOptions).toHaveBeenCalledTimes(2);
    expect(mediapipe.createFromOptions.mock.calls.map((call) => call[1].baseOptions.delegate))
      .toEqual(['GPU', 'CPU']);
    expect(mediapipe.forVisionTasks).toHaveBeenCalledOnce();
  });

  it('serializes concurrent initialization attempts', async () => {
    const firstLandmarker = fakeLandmarker();
    const secondLandmarker = fakeLandmarker();
    const first = deferred<typeof firstLandmarker>();
    mediapipe.createFromOptions
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(secondLandmarker);

    const firstDetector = createFaceDetector(DEMO_CONFIG.detector);
    const secondDetector = createFaceDetector(DEMO_CONFIG.detector);
    await Promise.resolve();
    await Promise.resolve();

    expect(mediapipe.forVisionTasks).toHaveBeenCalledOnce();
    expect(mediapipe.createFromOptions).toHaveBeenCalledOnce();

    first.resolve(firstLandmarker);
    await firstDetector;
    await secondDetector;
    expect(mediapipe.forVisionTasks).toHaveBeenCalledTimes(2);
    expect(mediapipe.createFromOptions).toHaveBeenCalledTimes(2);
  });

  it('continues the global initialization queue after a rejected attempt', async () => {
    const landmarker = fakeLandmarker();
    mediapipe.createFromOptions
      .mockRejectedValueOnce(new Error('automatic GPU failed'))
      .mockRejectedValueOnce(new Error('automatic CPU failed'))
      .mockRejectedValueOnce(new Error('nosimd GPU failed'))
      .mockRejectedValueOnce(new Error('nosimd CPU failed'))
      .mockResolvedValueOnce(landmarker);

    const failed = createFaceDetector(DEMO_CONFIG.detector);
    const recovered = createFaceDetector(DEMO_CONFIG.detector);

    await expect(failed).rejects.toBeInstanceOf(DetectorInitializationError);
    const detector = await recovered;
    expect(mediapipe.createFromOptions).toHaveBeenCalledTimes(5);
    expect(detector).toBeDefined();
  });

  it('reports bounded sanitized errors after both runtime variants fail', async () => {
    mediapipe.createFromOptions.mockRejectedValue(new Error('failed at https://secret.example/path?token=value'));

    const pending = createFaceDetector(DEMO_CONFIG.detector);
    await expect(pending).rejects.toBeInstanceOf(DetectorInitializationError);
    await expect(pending).rejects.not.toThrow('token=value');
    await expect(pending).rejects.toThrow('[url]');
    expect(detectorErrorMessage(new Error('plain failure'))).toBe('MediaPipe 初始化失败：plain failure');
    const sanitized = detectorErrorMessage(
      new Error('load /vendor/mediapipe/model.task token=private-value Bearer abc.def'),
    );
    expect(sanitized).not.toContain('/vendor/mediapipe/model.task');
    expect(sanitized).not.toContain('private-value');
    expect(sanitized).not.toContain('abc.def');
    expect(sanitized.length).toBeLessThanOrEqual(260);
  });
});
