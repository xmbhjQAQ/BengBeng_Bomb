import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackData } from '../../shared/contracts';
import { ApiClientError } from '../api/client';
import { readActiveAttempt, removeActiveAttempt, writeActiveAttempt } from '../storage/activeAttempts';
import { ChallengeView } from './ChallengeView';

const mocks = vi.hoisted(() => {
  const demo = {
    result: null as null | { outcome: 'completed' | 'failed'; videoPositionSeconds: number; scoreTrace: Array<{timeSeconds:number;score:number}> },
    phase: 'preparing',
    cameraStatus: 'idle',
    detectorStatus: 'idle',
    detectorError: null as string | null,
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

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, post: mocks.post };
});
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
vi.mock('./Settlement', () => ({
  Settlement: ({ result }: { result: { outcome: string; elapsedSeconds: number } }) => (
    <><div>settlement</div><div data-testid="settlement-details">{result.outcome}:{result.elapsedSeconds}</div></>
  ),
}));

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
    createdAt: Math.floor(Date.now() / 1000) - 100,
    expiresAt: Math.floor(Date.now() / 1000) + 3_600,
    nonce: 'nonce',
    mode: 'classic',
  },
  playback,
  stats: { total: 0, held: 0, failed: 0, failureRate: 0, averageElapsedSeconds: 0, buckets: [] },
  session: { state: 'opened' },
};

describe('ChallengeView', () => {
  afterEach(cleanup);

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    mocks.post.mockReset();
    Object.assign(mocks.demo, {
      result: null,
      phase: 'preparing',
      cameraStatus: 'idle',
      detectorStatus: 'idle',
      detectorError: null,
      profile: null,
      canCalibrate: false,
      canStart: false,
      videoReady: false,
      bilibiliSelection: null,
    });
    mocks.demo.selectResolvedBilibili.mockReset();
    mocks.demo.openCamera.mockReset();
    mocks.demo.closeCamera.mockReset();
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

  it('keeps the challenge error state inside the challenge flow without a home link', async () => {
    mocks.post.mockRejectedValueOnce(new Error('网络暂时不可用'));
    render(<ChallengeView token="public-token" />);

    expect(await screen.findByRole('heading', { name: '挑战无法打开' })).toBeVisible();
    expect(screen.queryByRole('link', { name: '返回首页' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '回到首页' })).not.toBeInTheDocument();
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
    expect(readActiveAttempt('single', 'public-token')).toMatchObject({
      attemptToken: 'attempt-token',
      challengeToken: 'public-token',
    });

    mocks.post.mockResolvedValueOnce({
      outcome: 'failed',
      elapsedSeconds: 12,
      reportUrl: 'https://example.com/r/report',
      stats: opened.stats,
    });
    Object.assign(mocks.demo, {
      phase: 'failed',
      result: { outcome: 'failed', videoPositionSeconds: 12, scoreTrace: [{timeSeconds:12,score:80}] },
    });
    view.rerender(<ChallengeView token="public-token" />);
    expect(screen.getByText(/正在保存挑战结果/)).toBeInTheDocument();
    expect(mocks.demo.closeCamera).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('settlement')).toBeInTheDocument());
    expect(JSON.parse(sessionStorage.getItem('bengbeng-completed:public-token') || '{}')).toMatchObject({
      outcome: 'failed', elapsedSeconds: 12, scoreTrace: [{ timeSeconds: 12, score: 80 }],
    });

    expect(window.location.href).toBe(initialHref);
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('keeps a failed submission on-page and retries the same result', async () => {
    sessionStorage.setItem('bengbeng-attempt:public-token', 'existing-attempt');
    mocks.post.mockResolvedValueOnce({ ...opened, session: { state: 'started' } });
    const view = render(<ChallengeView token="public-token" />);
    fireEvent.click(await screen.findByRole('button', { name: '重新开始本轮' }));
    await screen.findByText('测试视频');
    fireEvent.click(screen.getByRole('button', { name: '我知道了，接受挑战' }));
    mocks.post.mockRejectedValueOnce(new Error('网络暂时不可用'));
    Object.assign(mocks.demo, { phase: 'completed', result: { outcome: 'completed', videoPositionSeconds: 60, scoreTrace: [{timeSeconds:1,score:12}] } });
    view.rerender(<ChallengeView token="public-token" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('网络暂时不可用');
    expect(sessionStorage.getItem('bengbeng-attempt:public-token')).toBe('existing-attempt');
    mocks.post.mockResolvedValueOnce({ outcome: 'held', elapsedSeconds: 60, reportUrl: 'https://example.com/r/report', stats: opened.stats });
    fireEvent.click(screen.getByRole('button', { name: '重新提交' }));
    await waitFor(() => expect(screen.getByText('settlement')).toBeInTheDocument());
    const completionCalls = mocks.post.mock.calls.filter(([path]) => path === '/api/challenges/complete');
    expect(completionCalls).toHaveLength(2);
    expect(completionCalls[1]?.[1]).toEqual(completionCalls[0]?.[1]);
    expect(completionCalls[0]?.[1]).toMatchObject({ scoreTrace: [{timeSeconds:1,score:12}] });
    expect(sessionStorage.getItem('bengbeng-attempt:public-token')).toBeNull();
    expect(readActiveAttempt('single', 'public-token')).toBeNull();
  });

  it('migrates a legacy single attempt and asks before restarting from calibration', async () => {
    sessionStorage.setItem('bengbeng-attempt:public-token', 'legacy-attempt');
    mocks.post.mockResolvedValueOnce({ ...opened, session: { state: 'started' } });
    const view = render(<ChallengeView token="public-token" />);

    expect(await screen.findByRole('heading', { name: '上次挑战还没有完成' })).toBeVisible();
    expect(readActiveAttempt('single', 'public-token')).toMatchObject({ attemptToken: 'legacy-attempt' });
    expect(mocks.post).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '重新开始本轮' }));
    expect(screen.getByRole('button', { name: '我知道了，接受挑战' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '我知道了，接受挑战' }));
    Object.assign(mocks.demo, {
      phase: 'ready', profile: { quality: 'good' }, cameraStatus: 'ready', detectorStatus: 'ready',
      canStart: true, videoReady: true, bilibiliSelection: { dimension: { width: 16, height: 9 } },
    });
    view.rerender(<ChallengeView token="public-token" />);
    fireEvent.click(screen.getByRole('button', { name: '开始挑战' }));

    await waitFor(() => expect(mocks.demo.startChallenge).toHaveBeenCalledTimes(1));
    expect(mocks.post.mock.calls.filter(([path]) => path === '/api/challenges/start')).toHaveLength(0);
  });

  it('drops a stale local bearer when the server still reports an opened challenge', async () => {
    writeActiveAttempt({
      kind: 'single', challengeToken: 'public-token', attemptToken: 'stale-attempt',
      startedAt: Math.floor(Date.now() / 1000) - 10, expiresAt: Math.floor(Date.now() / 1000) + 3_600,
    });
    sessionStorage.setItem('bengbeng-attempt:public-token', 'stale-attempt');
    mocks.post.mockResolvedValueOnce(opened);

    render(<ChallengeView token="public-token" />);

    expect(await screen.findByText('测试视频')).toBeVisible();
    await waitFor(() => expect(readActiveAttempt('single', 'public-token')).toBeNull());
    expect(sessionStorage.getItem('bengbeng-attempt:public-token')).toBeNull();
    expect(screen.queryByRole('heading', { name: '上次挑战还没有完成' })).not.toBeInTheDocument();
  });

  it('recovers a group attempt with its original nickname without starting twice', async () => {
    writeActiveAttempt({
      kind: 'group', challengeToken: 'group-token', attemptToken: 'group-attempt', attemptId: 'attempt-id',
      nickname: '群友甲', startedAt: Math.floor(Date.now() / 1000) - 10,
      expiresAt: Math.floor(Date.now() / 1000) + 3_600,
    });
    mocks.post.mockResolvedValueOnce({
      challenge: { ...opened.challenge, kind: 'group-invitation', mode: 'group' },
      group: { ...opened.challenge, kind: 'group-invitation', mode: 'group', state: 'active' },
      playback, stats: opened.stats, session: null,
    });
    const view = render(<ChallengeView token="group-token" group />);

    expect(await screen.findByRole('heading', { name: '上次挑战还没有完成' })).toBeVisible();
    expect(screen.getByText('本轮仍使用昵称“群友甲”。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重新开始本轮' }));
    fireEvent.click(screen.getByRole('button', { name: '我知道了，接受挑战' }));
    Object.assign(mocks.demo, {
      phase: 'ready', profile: { quality: 'good' }, cameraStatus: 'ready', detectorStatus: 'ready',
      canStart: true, videoReady: true, bilibiliSelection: { dimension: { width: 16, height: 9 } },
    });
    view.rerender(<ChallengeView token="group-token" group />);
    expect(screen.getByRole('textbox', { name: /你的昵称/ })).toHaveValue('群友甲');
    expect(screen.getByRole('textbox', { name: /你的昵称/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '开始挑战' }));

    await waitFor(() => expect(mocks.demo.startChallenge).toHaveBeenCalledTimes(1));
    expect(mocks.post.mock.calls.filter(([path]) => path === '/api/groups/start')).toHaveLength(0);
  });

  it('migrates an old group attempt without a nickname and still reuses its bearer', async () => {
    sessionStorage.setItem('bengbeng-group-attempt:group-token', 'legacy-group-attempt');
    sessionStorage.setItem('bengbeng-group-attempt-id:group-token', 'legacy-group-id');
    mocks.post.mockResolvedValueOnce({
      challenge: { ...opened.challenge, kind: 'group-invitation', mode: 'group' },
      group: { ...opened.challenge, kind: 'group-invitation', mode: 'group', state: 'active' },
      playback, stats: opened.stats, session: null,
    });
    const view = render(<ChallengeView token="group-token" group />);

    expect(await screen.findByRole('heading', { name: '上次挑战还没有完成' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重新开始本轮' }));
    fireEvent.click(screen.getByRole('button', { name: '我知道了，接受挑战' }));
    Object.assign(mocks.demo, {
      phase: 'ready', profile: { quality: 'good' }, cameraStatus: 'ready', detectorStatus: 'ready',
      canStart: true, videoReady: true, bilibiliSelection: { dimension: { width: 16, height: 9 } },
    });
    view.rerender(<ChallengeView token="group-token" group />);
    expect(screen.getByText('恢复后会沿用本轮开始时填写的昵称。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '开始挑战' }));
    await waitFor(() => expect(mocks.demo.startChallenge).toHaveBeenCalledTimes(1));
    expect(mocks.post.mock.calls.filter(([path]) => path === '/api/groups/start')).toHaveLength(0);
  });

  it('clears an invalid persisted attempt but preserves it after a temporary submission error', async () => {
    writeActiveAttempt({
      kind: 'single', challengeToken: 'public-token', attemptToken: 'persisted-attempt',
      startedAt: Math.floor(Date.now() / 1000) - 10, expiresAt: Math.floor(Date.now() / 1000) + 3_600,
    });
    mocks.post.mockResolvedValueOnce({ ...opened, session: { state: 'started' } });
    const view = render(<ChallengeView token="public-token" />);
    await screen.findByRole('heading', { name: '上次挑战还没有完成' });
    fireEvent.click(screen.getByRole('button', { name: '重新开始本轮' }));
    fireEvent.click(screen.getByRole('button', { name: '我知道了，接受挑战' }));

    mocks.post.mockRejectedValueOnce(new Error('网络暂时不可用'));
    Object.assign(mocks.demo, { phase: 'failed', result: { outcome: 'failed', videoPositionSeconds: 8, scoreTrace: [] } });
    view.rerender(<ChallengeView token="public-token" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('网络暂时不可用');
    expect(readActiveAttempt('single', 'public-token')).not.toBeNull();

    mocks.post.mockRejectedValueOnce(new ApiClientError('INVALID_ATTEMPT', '本轮挑战已经失效，请重新开始。'));
    fireEvent.click(screen.getByRole('button', { name: '重新提交' }));
    expect(await screen.findByRole('heading', { name: '本轮挑战已结束' })).toBeVisible();
    expect(readActiveAttempt('single', 'public-token')).toBeNull();
  });

  it('stops a recovered page when another tab removes the active attempt', async () => {
    writeActiveAttempt({
      kind: 'single', challengeToken: 'public-token', attemptToken: 'shared-attempt',
      startedAt: Math.floor(Date.now() / 1000) - 10, expiresAt: Math.floor(Date.now() / 1000) + 3_600,
    });
    mocks.post.mockResolvedValueOnce({ ...opened, session: { state: 'started' } });
    render(<ChallengeView token="public-token" />);
    await screen.findByRole('heading', { name: '上次挑战还没有完成' });

    removeActiveAttempt('single', 'public-token');

    expect(await screen.findByRole('heading', { name: '本轮挑战已结束' })).toBeVisible();
    expect(screen.getByText(/其他页面完成或失效/)).toBeVisible();
    expect(mocks.demo.closeCamera).toHaveBeenCalledTimes(1);
  });

  it('stops a stale group tab without deleting a replacement participant attempt', async () => {
    writeActiveAttempt({
      kind: 'group', challengeToken: 'group-token', attemptToken: 'old-attempt', attemptId: 'old-id',
      nickname: '旧参与者', startedAt: Math.floor(Date.now() / 1000) - 10,
      expiresAt: Math.floor(Date.now() / 1000) + 3_600,
    });
    mocks.post.mockResolvedValueOnce({
      challenge: { ...opened.challenge, kind: 'group-invitation', mode: 'group' },
      group: { ...opened.challenge, kind: 'group-invitation', mode: 'group', state: 'active' },
      playback, stats: opened.stats, session: null,
    });
    render(<ChallengeView token="group-token" group />);
    await screen.findByRole('heading', { name: '上次挑战还没有完成' });

    writeActiveAttempt({
      kind: 'group', challengeToken: 'group-token', attemptToken: 'new-attempt', attemptId: 'new-id',
      nickname: '新参与者', startedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 3_600,
    });

    expect(await screen.findByRole('heading', { name: '本轮挑战已结束' })).toBeVisible();
    expect(readActiveAttempt('group', 'group-token')).toMatchObject({
      attemptToken: 'new-attempt',
      attemptId: 'new-id',
    });
  });

  it('restores the private settlement after a refresh in the same tab', async () => {
    sessionStorage.setItem('bengbeng-completed:public-token', JSON.stringify({
      outcome: 'held', elapsedSeconds: 60, reportUrl: 'https://example.com/r/report', stats: opened.stats,
      scoreTrace: [{ timeSeconds: 1, score: 12 }],
    }));
    mocks.post.mockResolvedValueOnce({
      ...opened,
      session: { state: 'completed', result_expires_at: Math.floor(Date.now() / 1000) + 3600 },
    });

    render(<ChallengeView token="public-token" />);

    expect(await screen.findByTestId('settlement-details')).toHaveTextContent('held:60');
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls.some(([path]) => path === '/api/challenges/complete')).toBe(false);
  });

  it('clears a cached settlement when the server no longer reports a completed session', async () => {
    sessionStorage.setItem('bengbeng-completed:public-token', JSON.stringify({
      outcome: 'failed', elapsedSeconds: 12, reportUrl: 'https://example.com/r/report', stats: opened.stats,
      scoreTrace: [{ timeSeconds: 12, score: 80 }],
    }));
    mocks.post.mockResolvedValueOnce(opened);

    render(<ChallengeView token="public-token" />);

    expect(await screen.findByText('测试视频')).toBeInTheDocument();
    expect(screen.queryByText('settlement')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('bengbeng-completed:public-token')).toBeNull();
  });

  it('does not restore a settlement after the server-side result expiry', async () => {
    sessionStorage.setItem('bengbeng-completed:public-token', JSON.stringify({
      outcome: 'held', elapsedSeconds: 60, reportUrl: 'https://example.com/r/report', stats: opened.stats,
      scoreTrace: [{ timeSeconds: 1, score: 12 }],
    }));
    mocks.post.mockResolvedValueOnce({
      ...opened,
      session: { state: 'completed', result_expires_at: Math.floor(Date.now() / 1000) - 1 },
    });

    render(<ChallengeView token="public-token" />);

    expect(await screen.findByText('这枚炸弹已经引爆过了')).toBeVisible();
    expect(sessionStorage.getItem('bengbeng-completed:public-token')).toBeNull();
  });

  it('uses the unified single-person wording without a fake identity', async () => {
    mocks.post.mockResolvedValue({ ...opened, challenge: { ...opened.challenge, mode: 'self', initiator: undefined } });
    render(<ChallengeView token="self-token" />);
    expect(await screen.findByText('单人挑战')).toBeVisible();
    expect(screen.getByRole('heading', { name: '看看你能绷到第几秒' })).toBeVisible();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });
});
