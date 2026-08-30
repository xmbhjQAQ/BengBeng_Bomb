import { StrictMode, type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_CONFIG } from '../app/config';
import type { FaceDetector } from './types';
import { useDetector } from './useDetector';

const adapter = vi.hoisted(() => ({
  createFaceDetector: vi.fn(),
  detectorErrorMessage: vi.fn((error: unknown) =>
    error instanceof Error ? `安全错误：${error.message}` : '安全错误'),
}));

vi.mock('./mediapipeAdapter', () => adapter);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const fakeDetector = (): FaceDetector => ({ detect: vi.fn(), close: vi.fn() });
const strictWrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;

describe('useDetector', () => {
  beforeEach(() => {
    adapter.createFaceDetector.mockReset();
    adapter.detectorErrorMessage.mockClear();
  });

  it('reuses one pending initialization during StrictMode replay and closes it on unmount', async () => {
    const initialization = deferred<FaceDetector>();
    const detector = fakeDetector();
    adapter.createFaceDetector.mockReturnValue(initialization.promise);
    const view = renderHook(
      () => useDetector(true, DEMO_CONFIG.detector, 0),
      { wrapper: strictWrapper },
    );

    expect(adapter.createFaceDetector).toHaveBeenCalledOnce();
    await act(async () => { initialization.resolve(detector); });
    await waitFor(() => expect(view.result.current.status).toBe('ready'));
    expect(view.result.current.detector).toBe(detector);
    expect(detector.close).not.toHaveBeenCalled();

    view.unmount();
    expect(detector.close).toHaveBeenCalledOnce();
  });

  it('allows an explicit retry after rejection and exposes the sanitized error', async () => {
    const first = deferred<FaceDetector>();
    const second = deferred<FaceDetector>();
    const detector = fakeDetector();
    adapter.createFaceDetector
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = renderHook(
      ({ retryKey }) => useDetector(true, DEMO_CONFIG.detector, retryKey),
      { initialProps: { retryKey: 0 } },
    );

    await act(async () => { first.reject(new Error('runtime failed')); });
    expect(view.result.current.status).toBe('error');
    expect(view.result.current.error).toBe('安全错误：runtime failed');
    expect(consoleError).toHaveBeenCalledWith('[face-detector]', '安全错误：runtime failed');

    view.rerender({ retryKey: 1 });
    expect(adapter.createFaceDetector).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve(detector); });
    expect(view.result.current.status).toBe('ready');
    expect(view.result.current.error).toBeNull();
    consoleError.mockRestore();
  });
});
