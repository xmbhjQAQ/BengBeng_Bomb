import type { FaceDetector, InferenceLoopHandlers } from './types';

export function startInferenceLoop(
  video: HTMLVideoElement,
  detector: FaceDetector,
  targetFps: number,
  handlers: InferenceLoopHandlers,
) {
  let active = true;
  let frameId = 0;
  let lastRun = 0;
  let busy = false;
  const interval = 1_000 / Math.max(1, targetFps);

  const tick = (timestamp: number) => {
    if (!active) return;
    const due = timestamp - lastRun >= interval;
    if (due) {
      lastRun = timestamp;
    }
    if (due && busy) handlers.onSkippedFrame?.('busy');
    else if (due && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      handlers.onSkippedFrame?.('video-not-ready');
    } else if (due) {
      busy = true;
      try {
        handlers.onResult(detector.detect(video, timestamp));
      } catch (error) {
        active = false;
        handlers.onTerminated({ reason: 'detection-error', error });
        return;
      } finally {
        busy = false;
      }
    }
    frameId = requestAnimationFrame(tick);
  };

  frameId = requestAnimationFrame(tick);
  return () => {
    active = false;
    cancelAnimationFrame(frameId);
  };
}
