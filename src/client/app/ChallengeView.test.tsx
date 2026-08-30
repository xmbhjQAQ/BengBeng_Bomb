import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackData } from '../../shared/contracts';
import { ChallengeView } from './ChallengeView';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  selectResolvedBilibili: vi.fn(),
}));

vi.mock('../api/client', () => ({ post: mocks.post }));
vi.mock('../gameplay/app/useSmileDemo', () => ({
  useSmileDemo: () => ({
    result: null,
    phase: 'preparing',
    cameraStatus: 'idle',
    detectorStatus: 'idle',
    calibrationIssue: null,
    calibrationProgress: 0,
    profile: null,
    canCalibrate: false,
    canStart: false,
    sample: null,
    countdownSeconds: null,
    playerError: null,
    danmakuStatus: 'unavailable',
    bilibiliSelection: null,
    selectResolvedBilibili: mocks.selectResolvedBilibili,
    openCamera: vi.fn(),
    retryDetector: vi.fn(),
    startCalibration: vi.fn(),
    startChallenge: vi.fn(),
    restart: vi.fn(),
    setCameraElement: vi.fn(),
    setPlayerContainer: vi.fn(),
  }),
}));
vi.mock('../gameplay/app/CameraPanel', () => ({ CameraPanel: () => <div>camera</div> }));
vi.mock('../gameplay/app/ChallengePanel', () => ({ ChallengePanel: () => <div>player</div> }));
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

describe('ChallengeView', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.post.mockReset();
    mocks.selectResolvedBilibili.mockReset();
  });

  it('uses the playback resolved by the open endpoint and shows video context before consent', async () => {
    mocks.post.mockResolvedValue({
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
    });

    render(<ChallengeView token="public-token" />);

    expect(await screen.findByText('测试视频')).toBeInTheDocument();
    expect(screen.getByText('视频简介')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '视频封面' })).toHaveAttribute('referrerPolicy', 'no-referrer');
    await waitFor(() => expect(mocks.selectResolvedBilibili).toHaveBeenCalledWith(playback));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/api/challenges/open', { challengeToken: 'public-token' });
  });
});
