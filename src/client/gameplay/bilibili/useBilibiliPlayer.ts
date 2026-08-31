import { useCallback, useEffect, useRef, useState } from 'react';
import Artplayer from 'artplayer';
import artplayerPluginDanmuku from 'artplayer-plugin-danmuku';
import { t } from '../i18n';
import {
  BilibiliApiError,
  BilibiliInputError,
  getBilibiliMediaCandidates,
  normalizeBilibiliAssetUrl,
  parseBilibiliInput,
  parseVideoByBvid,
  type BilibiliVideoData,
} from './bilibili';
import { installPlaybackGate } from './playbackGate';
import { installSeekInteractionLock } from './seekInteractionLock';

export type DanmakuStatus = 'unavailable' | 'loading' | 'ready' | 'error';

interface DanmakuItem {
  text: string;
  time: number;
  mode: 0 | 1 | 2;
  color?: string;
}

export type BilibiliSourceSelection = BilibiliVideoData;

export interface BilibiliPlayerMediaHandlers {
  onPause(): void;
  onSeeking(): void;
  onRateChange(): void;
  onWaiting(): void;
  onPlaying(): void;
  onEnded(): void;
  onError(): void;
}

function parseDanmakuXml(xml: string): DanmakuItem[] {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  if (parsed.querySelector('parsererror')) throw new Error('弹幕暂时无法显示，但不影响挑战。');
  return Array.from(parsed.querySelectorAll('d')).flatMap((item) => {
    const values = item.getAttribute('p')?.split(',') ?? [];
    const time = Number(values[0]);
    if (values.length < 4 || !Number.isFinite(time)) return [];
    const rawMode = Number(values[1]);
    const mode: 0 | 1 | 2 = rawMode === 4 ? 2 : rawMode === 5 ? 1 : 0;
    const colorNumber = Number(values[3]);
    return [{
      text: item.textContent?.trim() ?? '',
      time,
      mode,
      color: Number.isFinite(colorNumber) ? `#${colorNumber.toString(16)}` : undefined,
    }];
  });
}

interface UseBilibiliPlayerOptions {
  apiBaseUrl: string;
  apiKey: string;
  page: number;
  qn: number;
  active: boolean;
  metadataTimeoutMs: number;
}

export function useBilibiliPlayer(options: UseBilibiliPlayerOptions) {
  const [selection, setSelection] = useState<BilibiliSourceSelection | null>(null);
  const [loading, setLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [danmakuStatus, setDanmakuStatus] = useState<DanmakuStatus>('unavailable');
  const [ready, setReady] = useState(false);
  const [element, setElement] = useState<HTMLVideoElement | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const playerRef = useRef<Artplayer | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const mediaHandlersRef = useRef<BilibiliPlayerMediaHandlers | null>(null);
  const elementRef = useRef<HTMLVideoElement | null>(null);
  const expectedPause = useRef(0);
  const expectedSeek = useRef(0);
  const playbackAuthorized = useRef(false);
  const refreshKeyRef = useRef<string | null>(null);
  const refreshUsedRef = useRef(false);

  const setMediaHandlers = useCallback((handlers: BilibiliPlayerMediaHandlers) => {
    mediaHandlersRef.current = handlers;
  }, []);

  const loadResolved = useCallback((data: BilibiliVideoData) => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setSourceError(null);
    setSelection(data);
    setPlayerError(null);
    setDanmakuStatus('unavailable');
    setReady(false);
    return data;
  }, []);

  const load = useCallback(async (input: string) => {
    // A deliberate user reload starts a fresh one-time recovery budget.
    refreshKeyRef.current = null;
    refreshUsedRef.current = false;
    let parsed: ReturnType<typeof parseBilibiliInput>;
    try {
      parsed = parseBilibiliInput(input);
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : '链接解析失败。');
      return null;
    }

    const requestId = ++requestIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setSourceError(null);
    try {
      const data = await parseVideoByBvid({
        bvid: parsed.bvid,
        page: options.page,
        qn: options.qn,
        apiBaseUrl: options.apiBaseUrl,
        apiKey: options.apiKey,
        signal: controller.signal,
      });
      if (requestId !== requestIdRef.current) return null;
      return loadResolved(data);
    } catch (error) {
      if (requestId !== requestIdRef.current) return null;
      const message = error instanceof BilibiliApiError || error instanceof BilibiliInputError
        ? error.message
        : error instanceof Error
          ? error.message
          : '解析失败，请稍后重试。';
      setSourceError(message);
      return null;
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [loadResolved, options.apiBaseUrl, options.apiKey, options.page, options.qn]);

  useEffect(() => {
    if (!selection || !container) return;
    const selectionKey = `${selection.bvid}:${selection.page ?? options.page}`;
    if (refreshKeyRef.current !== selectionKey) {
      refreshKeyRef.current = selectionKey;
      refreshUsedRef.current = false;
    }
    let refreshController: AbortController | null = null;
    const mount = document.createElement('div');
    mount.className = 'artplayer-app';
    container.replaceChildren(mount);
    setReady(false);
    setPlayerError(null);
    expectedPause.current = 0;
    expectedSeek.current = 0;
    playbackAuthorized.current = false;

    const danmakuUrl = selection.danmukuUrl || selection.danmakuUrl || selection.danmaku?.url;
    if (danmakuUrl) mount.classList.add('has-danmaku');
    setDanmakuStatus(danmakuUrl ? 'loading' : 'unavailable');
    let danmakuFailed = false;

    const loadDanmaku = async (): Promise<DanmakuItem[]> => {
      if (!danmakuUrl) return [];
      try {
        const response = await fetch(danmakuUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error('弹幕暂时无法加载，但不影响挑战。');
        const items = parseDanmakuXml(await response.text());
        return items;
      } catch {
        danmakuFailed = true;
        setDanmakuStatus('error');
        return [];
      }
    };

    const mediaCandidates = getBilibiliMediaCandidates(selection);
    const initialMediaUrl = mediaCandidates[0] || normalizeBilibiliAssetUrl(selection.directUrl);
    const player = new Artplayer({
      container: mount,
      // Set the URL after ArtPlayer has created the video element. This lets
      // moreVideoAttr apply referrerPolicy before the browser starts a CDN
      // request; setting the attribute afterwards is too late on some browsers.
      url: '',
      volume: 0.7,
      autoplay: false,
      hotkey: false,
      // Disable ArtPlayer's mobile seek gesture. The progress control has its
      // own interaction lock below; this is a defensive fallback so a touch
      // can never fall through to the video and change currentTime.
      gesture: false,
      playsInline: true,
      moreVideoAttr: {
        referrerPolicy: 'no-referrer',
        playsInline: true,
        preload: 'auto',
      } as unknown as NonNullable<ConstructorParameters<typeof Artplayer>[0]['moreVideoAttr']>,
      theme: '#00aeec',
      fullscreen: true,
      fullscreenWeb: false,
      pip: false,
      setting: false,
      playbackRate: false,
      screenshot: false,
      miniProgressBar: false,
      plugins: danmakuUrl
        ? [artplayerPluginDanmuku({
            danmuku: loadDanmaku,
            emitter: false,
            antiOverlap: true,
            synchronousPlayback: true,
          })]
        : [],
    });
    // Keep the progress bar visible and the danmaku switch available. Playback itself
    // is owned by the challenge state machine, so the video click and the
    // play/pause control are blocked separately instead of hiding all controls.
    player.controls.show = true;
    const removeSeekInteractionLock = installSeekInteractionLock(player.template.$progress);
    playerRef.current = player;
    const video = player.template.$video;
    // Keep these assignments as a defensive fallback for browsers that do not
    // reflect every moreVideoAttr property consistently.
    video.setAttribute('referrerpolicy', 'no-referrer');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', 'true');
    video.playsInline = true;
    video.preload = 'auto';
    video.autoplay = false;
    video.controls = false;
    elementRef.current = video;
    setElement(video);

    const removePlaybackGate = installPlaybackGate(
      video,
      () => playbackAuthorized.current,
    );

    const preventUserPlayback = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    // ArtPlayer toggles playback from the video's click handler. Capture the
    // event before ArtPlayer sees it, while leaving the danmaku switch in the
    // controls bar interactive. The progress bar is locked by CSS at all times.
    video.addEventListener('click', preventUserPlayback, true);
    video.addEventListener('dblclick', preventUserPlayback, true);

    let metadataTimer: number | null = null;
    let mediaCandidateIndex = 0;
    let switchingCandidate = false;
    let finalErrorReported = false;
    let refreshPending = false;
    const hasVideoTrack = () => video.videoWidth > 0 && video.videoHeight > 0;
    const clearMetadataTimer = () => {
      if (metadataTimer !== null) {
        window.clearTimeout(metadataTimer);
        metadataTimer = null;
      }
    };

    const reportFinalError = (message: string) => {
      if (finalErrorReported) return;
      finalErrorReported = true;
      clearMetadataTimer();
      setReady(false);
      setPlayerError(message);
      mediaHandlersRef.current?.onError();
    };

    const refreshSelection = () => {
      if (refreshUsedRef.current || refreshPending) return false;
      refreshUsedRef.current = true;
      refreshPending = true;
      refreshController = new AbortController();
      setPlayerError('视频地址已失效，正在重新获取…');
      void parseVideoByBvid({
        bvid: selection.bvid,
        page: selection.page ?? options.page,
        qn: options.qn,
        apiBaseUrl: options.apiBaseUrl,
        apiKey: options.apiKey,
        signal: refreshController.signal,
      }).then((data) => {
        if (playerRef.current === player) loadResolved(data);
      }).catch(() => {
        if (playerRef.current === player) reportFinalError('视频地址已失效，请重新加载视频。');
      }).finally(() => {
        refreshPending = false;
        refreshController = null;
      });
      return true;
    };

    const switchToNextCandidate = () => {
      const nextIndex = mediaCandidateIndex + 1;
      if (nextIndex >= mediaCandidates.length || switchingCandidate) return false;
      switchingCandidate = true;
      clearMetadataTimer();
      setReady(false);
      setPlayerError(t.video.playerFallback);
      window.setTimeout(() => {
        if (playerRef.current !== player) return;
        mediaCandidateIndex = nextIndex;
        switchingCandidate = false;
        player.url = mediaCandidates[mediaCandidateIndex] || '';
        armMetadataTimer();
      }, 0);
      return true;
    };

    const armMetadataTimer = () => {
      clearMetadataTimer();
      metadataTimer = window.setTimeout(() => {
        if (playerRef.current !== player || hasVideoTrack() || finalErrorReported) return;
        if (refreshPending) return;
        if (switchToNextCandidate()) return;
        if (refreshSelection()) return;
        reportFinalError(t.video.playerNoVisual);
      }, Math.max(500, options.metadataTimeoutMs));
    };

    const markReady = () => {
      if (!hasVideoTrack()) return;
      clearMetadataTimer();
      setReady(true);
      setPlayerError(null);
    };
    const markVideoError = () => {
      if (switchingCandidate || refreshPending) return;
      if (switchToNextCandidate()) return;
      if (refreshSelection()) return;
      reportFinalError(t.video.playerFailed);
    };
    const handlePause = () => {
      playbackAuthorized.current = false;
      mediaHandlersRef.current?.onPause();
    };
    const handleSeeking = () => mediaHandlersRef.current?.onSeeking();
    const handleRateChange = () => mediaHandlersRef.current?.onRateChange();
    const handleWaiting = () => mediaHandlersRef.current?.onWaiting();
    const handlePlaying = () => mediaHandlersRef.current?.onPlaying();
    const handleEnded = () => {
      playbackAuthorized.current = false;
      mediaHandlersRef.current?.onEnded();
    };
    const handleDanmakuLoaded = () => {
      if (!danmakuFailed) setDanmakuStatus('ready');
    };
    const handleDanmakuError = () => setDanmakuStatus('error');

    video.addEventListener('loadedmetadata', markReady);
    video.addEventListener('loadeddata', markReady);
    video.addEventListener('canplay', markReady);
    video.addEventListener('error', markVideoError);
    video.addEventListener('pause', handlePause);
    video.addEventListener('seeking', handleSeeking);
    video.addEventListener('ratechange', handleRateChange);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('ended', handleEnded);
    player.on('artplayerPluginDanmuku:loaded', handleDanmakuLoaded);
    player.on('artplayerPluginDanmuku:error', handleDanmakuError);
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) markReady();

    // A media element can report a playable audio track without a video track.
    // Do not enable calibration/challenge in that state, and do not leave the
    // user staring at a black player forever.
    armMetadataTimer();

    if (initialMediaUrl) player.url = initialMediaUrl;

    return () => {
      clearMetadataTimer();
      refreshController?.abort();
      refreshController = null;
      video.removeEventListener('loadedmetadata', markReady);
      video.removeEventListener('loadeddata', markReady);
      video.removeEventListener('canplay', markReady);
      video.removeEventListener('error', markVideoError);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('seeking', handleSeeking);
      video.removeEventListener('ratechange', handleRateChange);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('click', preventUserPlayback, true);
      video.removeEventListener('dblclick', preventUserPlayback, true);
      removePlaybackGate();
      removeSeekInteractionLock();
      if (playerRef.current === player) playerRef.current = null;
      if (elementRef.current === video) {
        elementRef.current = null;
        setElement(null);
      }
      player.destroy(false);
      mount.remove();
    };
  }, [container, loadResolved, options.apiBaseUrl, options.apiKey, options.metadataTimeoutMs, options.page, options.qn, selection]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.controls.show = true;
    if (!options.active) {
      playbackAuthorized.current = false;
      if (!player.template.$video.paused) player.template.$video.pause();
    }
  }, [options.active]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    playerRef.current?.destroy(false);
    playerRef.current = null;
  }, []);

  const pause = useCallback(() => {
    const video = elementRef.current;
    playbackAuthorized.current = false;
    if (!video || video.paused) return;
    expectedPause.current += 1;
    video.pause();
  }, []);

  const reset = useCallback(() => {
    const video = elementRef.current;
    playbackAuthorized.current = false;
    if (!video) return;
    if (!video.paused) {
      expectedPause.current += 1;
      video.pause();
    }
    if (video.currentTime !== 0) {
      expectedSeek.current += 1;
      video.currentTime = 0;
    }
    video.playbackRate = 1;
  }, []);

  const play = useCallback(async () => {
    const video = elementRef.current;
    if (!video) throw new Error('video-not-mounted');
    video.playbackRate = 1;
    playbackAuthorized.current = true;
    try {
      await video.play();
    } catch (error) {
      playbackAuthorized.current = false;
      throw error;
    }
  }, []);

  const retryVideo = useCallback(() => {
    if (!selection?.bvid) return;
    void load(`https://www.bilibili.com/video/${selection.bvid}`);
  }, [load, selection]);

  const consumePause = useCallback(() => {
    if (expectedPause.current < 1) return false;
    expectedPause.current -= 1;
    return true;
  }, []);

  const consumeSeek = useCallback(() => {
    if (expectedSeek.current < 1) return false;
    expectedSeek.current -= 1;
    return true;
  }, []);

  return {
    selection,
    loading,
    sourceError,
    playerError,
    danmakuStatus,
    ready,
    element,
    load,
    retryVideo,
    loadResolved,
    setContainerElement: setContainer,
    setMediaHandlers,
    pause,
    reset,
    play,
    consumePause,
    consumeSeek,
  };
}
