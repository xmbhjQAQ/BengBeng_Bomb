import { describe, expect, it, vi } from 'vitest';
import { installPlaybackGate } from './playbackGate';

describe('installPlaybackGate', () => {
  it('blocks play calls until the challenge authorizes playback', async () => {
    const video = document.createElement('video');
    const nativePlay = vi.fn(async () => undefined);
    video.play = nativePlay;
    let authorized = false;
    const cleanup = installPlaybackGate(video, () => authorized);

    await video.play();
    expect(nativePlay).not.toHaveBeenCalled();

    authorized = true;
    await video.play();
    expect(nativePlay).toHaveBeenCalledTimes(1);

    cleanup();
    authorized = false;
    await video.play();
    expect(nativePlay).toHaveBeenCalledTimes(2);
  });

  it('immediately pauses playback started outside the guarded play method', () => {
    const video = document.createElement('video');
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => undefined);
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    const cleanup = installPlaybackGate(video, () => false);

    video.dispatchEvent(new Event('play'));
    expect(pause).toHaveBeenCalledTimes(1);

    cleanup();
  });
});
