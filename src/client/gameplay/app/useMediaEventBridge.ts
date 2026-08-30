import { useCallback, type RefObject } from 'react';
import { isActivePhase, type ChallengeEvent, type ChallengeState, type InvalidationReason } from '../challenge';

export function useMediaEventBridge(
  element: HTMLVideoElement | null,
  consumePause: () => boolean,
  consumeSeek: () => boolean,
  challengeRef: RefObject<ChallengeState>,
  dispatch: (event: ChallengeEvent) => void,
) {
  const invalidate = useCallback((reason: InvalidationReason) => {
    if (!isActivePhase(challengeRef.current.phase)) return;
    dispatch({ type: 'INVALIDATE', now: performance.now(), reason });
  }, [challengeRef, dispatch]);

  return {
    invalidate,
    onPause: () => {
      if (element?.ended || consumePause()) return;
      invalidate('unexpected-pause');
    },
    // The progress control is physically locked. A browser-level seeking
    // event that still slips through is ignored instead of invalidating the
    // whole round because an accidental touch must not end the challenge.
    onSeeking: () => { consumeSeek(); },
    onRateChange: () => {
      if (element?.playbackRate === 1) return;
      invalidate('rate-changed');
    },
    onWaiting: () => dispatch({ type: 'MEDIA_WAITING', now: performance.now() }),
    onPlaying: () => dispatch({ type: 'MEDIA_PLAYING', now: performance.now() }),
    onEnded: () => dispatch({
      type: 'VIDEO_ENDED',
      now: performance.now(),
      position: element?.currentTime ?? 0,
      duration: element && Number.isFinite(element.duration) ? element.duration : 0,
    }),
    onError: () => invalidate('video-error'),
  };
}
