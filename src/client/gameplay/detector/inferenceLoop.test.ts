import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startInferenceLoop } from './inferenceLoop';
import type { FaceDetector } from './types';

describe('startInferenceLoop', () => {
  let callbacks: Map<number, FrameRequestCallback>;
  let nextId: number;

  beforeEach(() => {
    callbacks = new Map();
    nextId = 1;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => callbacks.delete(id)));
  });

  it('runs at the capped cadence and stops scheduling after cleanup', () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_CURRENT_DATA });
    const detector: FaceDetector = {
      detect: vi.fn(() => ({
        observation: { timestamp: 100, faceCount: 0, confidence: 0, yaw: 0, roll: 0 },
        inferenceMs: 2,
      })),
      close: vi.fn(),
    };
    const onResult = vi.fn();
    const stop = startInferenceLoop(video, detector, 10, {
      onResult,
      onTerminated: vi.fn(),
    });
    callbacks.get(1)?.(100);
    expect(detector.detect).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledOnce();
    stop();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it('terminates with a typed error and does not schedule another frame', () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_CURRENT_DATA });
    const detector: FaceDetector = {
      detect: () => { throw new Error('failed'); },
      close: vi.fn(),
    };
    const onTerminated = vi.fn();
    startInferenceLoop(video, detector, 10, { onResult: vi.fn(), onTerminated });
    callbacks.get(1)?.(100);
    expect(onTerminated).toHaveBeenCalledWith({
      reason: 'detection-error',
      error: expect.any(Error),
    });
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });

  it('reports not-ready frames at the configured cadence instead of every animation frame', () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { value: 0 });
    const detector: FaceDetector = { detect: vi.fn(), close: vi.fn() };
    const onSkippedFrame = vi.fn();
    const stop = startInferenceLoop(video, detector, 10, {
      onResult: vi.fn(),
      onSkippedFrame,
      onTerminated: vi.fn(),
    });

    callbacks.get(1)?.(100);
    callbacks.get(2)?.(120);
    callbacks.get(3)?.(200);

    expect(onSkippedFrame).toHaveBeenCalledTimes(2);
    expect(onSkippedFrame).toHaveBeenCalledWith('video-not-ready');
    expect(detector.detect).not.toHaveBeenCalled();
    stop();
  });
});
