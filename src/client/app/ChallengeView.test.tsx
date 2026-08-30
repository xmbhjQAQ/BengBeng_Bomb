import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackData } from '../../shared/contracts';
import { ChallengeView } from './ChallengeView';

const mocks = vi.hoisted(() => {
  const demo = {
    result: null as null | { outcome: 'completed' | 'failed'; videoPositionSeconds: number },
    phase: 'preparing',
    cameraStatus: 'idle',
    detectorStatus: 'idle',
    calibrationIssue: null,
    calibrationProgress: 0,
    profile: null as null | { quality: 'good' },
    canCalibrate: false,
    canStart: false,
    videoReady: false,
    sample: null,
    countdownSeconds: null,
    playerError: null,
    danmakuStatus: 'unavailable',
    bilibiliSelection: null as null | { dimension?: { width: number; height: number } },
    selectResolvedBilibili: vi.fn(),
    openCamera: vi.fn(),
    closeCamera: vi.fn(),
    retryDetector: vi.fn(),
    startCalibration: vi.fn(),
    startChallenge: vi.fn(),
    restart: vi.fn(),
    setCameraElement: vi.fn(),
    setPlayerContainer: vi.fn(),
  };
  return { post: vi.fn(), demo };
});

vi.mock('../api/client', () => ({ post: mocks.post }));
vi.mock('../gameplay/app/useSmileDemo', () => ({ useSmileDemo: () => mocks.demo }));
vi.mock('../gameplay/app/CameraPanel', () => ({
  CameraPanel: ({ compact, bubble }: { compact?: boolean; bubble?: boolean }) => (
    <div>{`camera-${compact ? 'compact' : bubble ? 'bubble' : 'calibration'}`}</div>
  ),
}));
vi.mock('../gameplay/app/ChallengePanel', () => ({
  ChallengePanel: ({ onStart, canStart }: { onStart(): void; canStart: boolean }) => (
    <div>player-panel<button type="button" disabled={!canStart} onClick={onStart}>开始挑战</button></div>
  ),
}));
vi.mock('./Settlement', () => ({ Settlement: () => <div>settlement</div> }));

const playback: PlaybackData = {
  source: 'bilibili',
  bvid: 'BV1B7411m7LV',
  cid: 123,
  page: 1,
  title: '测试视频',
  description: '视频简介',
  cover: 'https://i0.hdslb.com/cover.jpg',
  duration: 60,
  media: ['https://cdn.example/video.mp4'],
  danmakuUrl: '/api/danmaku?challenge=public-token',
};

const opened = {
  challenge: {
    v: 1,
    kind: 'challenge',
    video: playback,
    initiator: '发起者',
    createdAt: 100,
    expiresAt: 200,
    nonce: 'nonce',
    mode: 'classic',
  },
  playback,
  stats: { total: 0, held: 0, failed: 0, failureRate: 0, averageElapsedSeconds: 0, buckets: [] },
  session: { state: 'opened' },
};

describe('ChallengeView', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.post.mockReset();
    Object.assign(mocks.demo, {
      result: null,
      phase: 'preparing',
      cameraStatus: 'idle',
      detectorStatus: 'idle',
      profile: null,
      canCalibrate: false,
      canStart: false,
      videoReady: false,
      bilibiliSelection: null,
    });
    mocks.demo.selectResolvedBilibili.mockReset();
    mocks.demo.openCamera.mockReset();
    mocks.demo.startChallenge.mockReset();
  });

  it('uses open playback and moves from consent to calibration without mounting the player', async () => {
    mocks.post.mockResolvedValue(opened);
    render(<ChallengeView token="public-token" />);

    expect(await screen.findByText('测试视频')).toBeInTheDocument();
    expect(screen.getByText('视频简介')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '视频封面' })).toHaveAttribute('referrerPolicy', 'no-referrer');
    await waitFor(() => expect(mocks.demo.selectResolvedBilibili).toHaveBeenCalledWith(playback));
    expect(mocks.post).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '我知道了，接受挑战' }));
    expect(await screen.findByText('camera-calibration')).toBeInTheDocument();
    expect(screen.queryByText('player-panel')).not.toBeInTheDocument();
    expect(mocks.demo.openCamera).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('starts only from ready and preserves the URL through submission and settlement', async () => {
    mocks.post.mockResolvedValueOnce(opened);
    const initialHref = window.location.href;
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    const view = render(<ChallengeView token="public-token" />);
    await screen.findByText('测试视频');
    fireEvent.click(screen.getByRole('button', { name: '我知道了，接受挑战' }));

    Object.assign(mocks.demo, {
      phase: 'ready',
      profile: { quality: 'good' },
      cameraStatus: 'ready',
      detectorStatus: 'ready',
      canStart: true,
      videoReady: true,
      bilibiliSelection: { dimension: { width: 16, height: 9 } },
    });
    view.rerender(<ChallengeView token="public-token" />);
    expect(screen.getByText('camera-compact')).toBeInTheDocument();
    expect(screen.getByText('player-panel')).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledTimes(1);

    mocks.post.mockResolvedValueOnce({ attemptToken: 'attempt-token' });
    fireEvent.click(screen.getByRole('button', { name: '开始挑战' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/api/challenges/start', { challengeToken: 'public-token' }));
    await waitFor(() => expect(mocks.demo.startChallenge).toHaveBeenCalledTimes(1));

    mocks.post.mockResolvedValueOnce({
      outcome: 'failed',
      elapsedSeconds: 12,
      reportUrl: 'https://example.com/r/report',
      stats: opened.stats,
    });
    Object.assign(mocks.demo, {
      phase: 'failed',
      result: { outcome: 'failed', videoPositionSeconds: 12 },
    });
    view.rerender(<ChallengeView token="public-token" />);
    expect(screen.getByText(/正在封存挑战结果/)).toBeInTheDocument();
    expect(mocks.demo.closeCamera).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('settlement')).toBeInTheDocument());

    expect(window.location.href).toBe(initialHref);
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('keeps a failed submission on-page and retries the same result', async () => {
    sessionStorage.setItem('bengbeng-attempt:public-token', 'existing-attempt');
    mocks.post.mockResolvedValueOnce(opened);
    const view = render(<ChallengeView token="public-token" />);
    await screen.findByText('测试视频');
    fireEvent.click(screen.getByRole('button', { name: '我知道了，接受挑战' }));
    mocks.post.mockRejectedValueOnce(new Error('网络暂时不可用'));
    Object.assign(mocks.demo, { phase: 'completed', result: { outcome: 'completed', videoPositionSeconds: 60 } });
    view.rerender(<ChallengeView token="public-token" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('网络暂时不可用');
    expect(sessionStorage.getItem('bengbeng-attempt:public-token')).toBe('existing-attempt');
    mocks.post.mockResolvedValueOnce({ outcome: 'held', elapsedSeconds: 60, reportUrl: 'https://example.com/r/report', stats: opened.stats });
    fireEvent.click(screen.getByRole('button', { name: '重新提交' }));
    await waitFor(() => expect(screen.getByText('settlement')).toBeInTheDocument());
    const completionCalls = mocks.post.mock.calls.filter(([path]) => path === '/api/challenges/complete');
    expect(completionCalls).toHaveLength(2);
    expect(completionCalls[1]?.[1]).toEqual(completionCalls[0]?.[1]);
    expect(sessionStorage.getItem('bengbeng-attempt:public-token')).toBeNull();
  });
});
