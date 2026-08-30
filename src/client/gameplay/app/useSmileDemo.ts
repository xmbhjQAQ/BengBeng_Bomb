import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlaybackData } from '../../../shared/contracts';
import { useBilibiliPlayer } from '../bilibili';
import type { BilibiliVideoData } from '../bilibili';
import { isActivePhase, RECOVERABLE_PHASES, type RecoverablePhase } from '../challenge';
import { useCamera } from '../camera';
import { useDetector } from '../detector';
import { createLocalResult, type LocalChallengeResult } from '../result';
import { DEMO_CONFIG, loadBilibiliRuntimeConfig } from './config';
import type { SmileDemoController } from './types';
import { useChallengeFlow } from './useChallengeFlow';
import { useInferenceSession } from './useInferenceSession';
import { useMediaEventBridge } from './useMediaEventBridge';
import { useVisibilityGuard } from './useVisibilityGuard';

export function useSmileDemo(): SmileDemoController {
  const camera = useCamera(DEMO_CONFIG.camera);
  const { status: cameraStatus, stream: cameraStream, start: startCamera, stop: stopCamera } = camera;
  const [detectorRetry, setDetectorRetry] = useState(0);
  const retryDetector = useCallback(() => setDetectorRetry((value) => value + 1), []);
  const detectorSession = useDetector(
    cameraStatus === 'ready',
    DEMO_CONFIG.detector,
    detectorRetry,
  );
  const { status: detectorStatus, detector, error: detectorError } = detectorSession;
  const [bilibiliConfig, setBilibiliConfig] = useState(DEMO_CONFIG.bilibili);
  const [playerActive, setPlayerActive] = useState(false);
  const bilibili = useBilibiliPlayer({
    ...bilibiliConfig,
    active: playerActive,
    metadataTimeoutMs: DEMO_CONFIG.video.metadataTimeoutMs,
  });
  const {
    selection: bilibiliSelection,
    loading: sourceLoading,
    sourceError,
    playerError,
    danmakuStatus,
    ready: videoReady,
    element: challengeVideo,
    load: loadBilibili,
    loadResolved,
    setContainerElement: setPlayerContainer,
    setMediaHandlers,
    pause,
    reset,
    play,
    consumePause,
    consumeSeek,
  } = bilibili;
  const [cameraElement, setCameraElement] = useState<HTMLVideoElement | null>(null);
  const [result, setResult] = useState<LocalChallengeResult | null>(null);
  const resultRef = useRef<LocalChallengeResult | null>(null);

  const mediaCommands = useMemo(() => ({ pause, reset, play }), [pause, play, reset]);
  const flow = useChallengeFlow(mediaCommands);
  const { state: challengeState, stateRef: challengeRef, dispatch, resetToSelecting } = flow;
  const inference = useInferenceSession({
    cameraElement,
    detector,
    challenge: challengeState,
    challengeRef,
    challengeVideo,
    dispatch,
    onDetectorTerminated: retryDetector,
  });
  const {
    profile,
    calibrationIssue,
    calibrationProgress,
    sample,
    metrics,
    resetAll,
    beginCalibration,
    beginChallenge,
    restartChallenge,
    getProfile,
    getMaximumScore,
    getScoreTrace,
  } = inference;
  const mediaEvents = useMediaEventBridge(
    challengeVideo,
    consumePause,
    consumeSeek,
    challengeRef,
    dispatch,
  );

  useEffect(() => {
    void loadBilibiliRuntimeConfig().then(setBilibiliConfig);
  }, []);

  useEffect(() => {
    setMediaHandlers(mediaEvents);
  }, [mediaEvents, setMediaHandlers]);

  useEffect(() => {
    setPlayerActive(isActivePhase(challengeState.phase));
  }, [challengeState.phase]);

  useEffect(() => {
    if (!cameraElement) return;
    cameraElement.srcObject = cameraStream;
    if (cameraStream) void cameraElement.play().catch(() => undefined);
    return () => {
      cameraElement.pause();
      cameraElement.srcObject = null;
    };
  }, [cameraElement, cameraStream]);

  useEffect(() => {
    if (!RECOVERABLE_PHASES.includes(challengeState.phase as RecoverablePhase)) return;
    const interval = window.setInterval(
      () => dispatch({ type: 'TICK', now: performance.now() }),
      100,
    );
    return () => window.clearInterval(interval);
  }, [challengeState.phase, dispatch]);

  const { invalidate } = mediaEvents;
  const invalidateHiddenPage = useCallback(() => invalidate('page-hidden'), [invalidate]);
  useVisibilityGuard(invalidateHiddenPage);

  useEffect(() => {
    if (cameraStatus === 'interrupted' && isActivePhase(challengeRef.current.phase)) {
      invalidate('camera-interrupted');
    }
  }, [cameraStatus, challengeRef, invalidate]);

  useEffect(() => {
    const settlement = challengeState.settlement;
    const calibratedProfile = getProfile();
    if (!settlement || !calibratedProfile || !bilibiliSelection || resultRef.current) return;
    const next = createLocalResult({
      settlement,
      profile: calibratedProfile,
      videoName: bilibiliSelection.title || bilibiliSelection.bvid,
      maximumSmoothedScore: getMaximumScore(),
      scoreTrace: getScoreTrace(),
    });
    resultRef.current = next;
    setResult(next);
  }, [bilibiliSelection, challengeState.settlement, getMaximumScore, getProfile, getScoreTrace]);

  const clearResult = useCallback(() => {
    resultRef.current = null;
    setResult(null);
  }, []);

  const selectBilibili = useCallback(async (input: string) => {
    const data = await loadBilibili(input);
    if (!data) return;
    resetToSelecting();
    resetAll();
    clearResult();
    dispatch({ type: 'VIDEO_SELECTED' });
  }, [clearResult, dispatch, loadBilibili, resetAll, resetToSelecting]);

  const selectResolvedBilibili = useCallback((playback: PlaybackData) => {
    const directUrl = playback.media[0];
    if (!directUrl) return;
    const data: BilibiliVideoData = {
      ...playback,
      directUrl,
      playback: { candidates: playback.media.map((url) => ({ url })) },
      danmakuUrl: playback.danmakuUrl,
      danmukuUrl: playback.danmakuUrl,
    };
    loadResolved(data);
    resetToSelecting();
    resetAll();
    clearResult();
    dispatch({ type: 'VIDEO_SELECTED' });
  }, [clearResult, dispatch, loadResolved, resetAll, resetToSelecting]);

  const startCalibration = useCallback(() => {
    if (cameraStatus !== 'ready' || detectorStatus !== 'ready' || !detector) return;
    beginCalibration();
  }, [beginCalibration, cameraStatus, detector, detectorStatus]);

  const startChallenge = useCallback(() => {
    if (
      !getProfile() ||
      !videoReady ||
      cameraStatus !== 'ready' ||
      detectorStatus !== 'ready' ||
      !detector
    ) return;
    clearResult();
    beginChallenge();
  }, [beginChallenge, cameraStatus, clearResult, detector, detectorStatus, getProfile, videoReady]);

  const restart = useCallback(() => {
    clearResult();
    restartChallenge();
    dispatch({ type: 'RESTART' });
  }, [clearResult, dispatch, restartChallenge]);

  const countdownSeconds = useMemo(() => {
    if (
      challengeState.phase !== 'resume-countdown' ||
      challengeState.countdownEndsAt === null
    ) return null;
    return Math.max(
      1,
      Math.ceil((challengeState.countdownEndsAt - performance.now()) / 1_000),
    );
  }, [challengeState.countdownEndsAt, challengeState.phase]);

  return {
    cameraStatus,
    detectorStatus,
    detectorError,
    phase: challengeState.phase,
    invalidReason: challengeState.invalidReason,
    bilibiliSelection,
    sourceLoading,
    sourceError,
    playerError,
    danmakuStatus,
    videoReady,
    profile,
    calibrationIssue,
    calibrationProgress,
    sample,
    metrics,
    result,
    countdownSeconds,
    canCalibrate:
      cameraStatus === 'ready' &&
      detectorStatus === 'ready' &&
      Boolean(detector) &&
      challengeState.phase === 'preparing',
    canStart:
      videoReady &&
      cameraStatus === 'ready' &&
      detectorStatus === 'ready' &&
      Boolean(detector) &&
      challengeState.phase === 'ready' &&
      profile?.quality === 'good',
    selectBilibili,
    selectResolvedBilibili,
    openCamera: () => void startCamera(),
    closeCamera: stopCamera,
    retryDetector,
    startCalibration,
    startChallenge,
    restart,
    setPlayerContainer,
    setCameraElement,
    onVideoPause: mediaEvents.onPause,
    onVideoSeeking: mediaEvents.onSeeking,
    onVideoRateChange: mediaEvents.onRateChange,
    onVideoWaiting: mediaEvents.onWaiting,
    onVideoPlaying: mediaEvents.onPlaying,
    onVideoEnded: mediaEvents.onEnded,
    onVideoError: mediaEvents.onError,
  };
}
