import { StrictMode, type PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCamera } from './useCamera';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
};

const fakeStream = () => {
  const stop = vi.fn();
  const addEventListener = vi.fn();
  const track = { stop, addEventListener } as unknown as MediaStreamTrack;
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, stop, addEventListener };
};

const strictWrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;

describe('useCamera', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports an insecure LAN context before requesting camera permission', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    try {
      const { result } = renderHook(() => useCamera({ width: 640, height: 480 }));
      await act(() => result.current.start());
      expect(result.current.status).toBe('insecure-context');
      expect(getUserMedia).not.toHaveBeenCalled();
    } finally {
      if (descriptor) Object.defineProperty(window, 'isSecureContext', descriptor);
      else Reflect.deleteProperty(window, 'isSecureContext');
    }
  });

  it('does not request permission until start is called', async () => {
    const getUserMedia = vi.fn(async () => fakeStream().stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    const { result } = renderHook(() => useCamera({ width: 640, height: 480 }));
    expect(getUserMedia).not.toHaveBeenCalled();
    await act(() => result.current.start());
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('ready');
  });

  it('stops a late stream after unmount', async () => {
    const request = deferred<MediaStream>();
    const late = fakeStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(() => request.promise) },
    });
    const { result, unmount } = renderHook(() => useCamera({ width: 640, height: 480 }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.start(); });
    unmount();
    request.resolve(late.stream);
    await pending;
    expect(late.stop).toHaveBeenCalledOnce();
  });

  it('stops an older request when a newer start supersedes it', async () => {
    const firstRequest = deferred<MediaStream>();
    const first = fakeStream();
    const second = fakeStream();
    const getUserMedia = vi.fn()
      .mockImplementationOnce(() => firstRequest.promise)
      .mockResolvedValueOnce(second.stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    const { result } = renderHook(() => useCamera({ width: 640, height: 480 }));
    let stale!: Promise<void>;
    act(() => { stale = result.current.start(); });
    await act(() => result.current.start());
    firstRequest.resolve(first.stream);
    await stale;

    expect(first.stop).toHaveBeenCalledOnce();
    expect(result.current.stream).toBe(second.stream);
  });

  it('publishes track interruption and explicitly stops a ready session', async () => {
    const active = fakeStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => active.stream) },
    });
    const { result } = renderHook(() => useCamera({ width: 640, height: 480 }));
    await act(() => result.current.start());
    const onEnded = active.addEventListener.mock.calls[0]?.[1] as (() => void) | undefined;
    act(() => onEnded?.());
    expect(result.current.status).toBe('interrupted');

    act(() => result.current.stop());
    expect(active.stop).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('idle');
    expect(result.current.stream).toBeNull();
  });

  it('remains safe under StrictMode replay and stops the mounted session on unmount', async () => {
    const active = fakeStream();
    const getUserMedia = vi.fn(async () => active.stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    const { result, unmount } = renderHook(
      () => useCamera({ width: 640, height: 480 }),
      { wrapper: strictWrapper },
    );
    await act(() => result.current.start());
    expect(getUserMedia).toHaveBeenCalledOnce();
    unmount();
    expect(active.stop).toHaveBeenCalledOnce();
  });
});
