import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChallengePayload } from '../../shared/contracts';

const shareMocks = vi.hoisted(() => ({
  createSettlementCard: vi.fn(async (input: unknown) => { void input; return new Blob(['png'], { type: 'image/png' }); }),
  downloadBlob: vi.fn(),
}));
vi.mock('../sharing/settlementCard', () => ({ createSettlementCard: shareMocks.createSettlementCard }));
vi.mock('../sharing/card', () => ({ downloadBlob: shareMocks.downloadBlob }));

import { Settlement, Stats } from './Settlement';

const base = { total: 0, held: 0, failed: 0, failureRate: 0, averageElapsedSeconds: 0 };

describe('Stats', () => {
  it('shows an explicit empty state without fake bars', () => {
    render(<Stats stats={{ ...base, buckets: [] }} />);
    expect(screen.getByText(/还没有人记录没绷住的时间/)).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('renders readable time ranges and counts for every bucket', () => {
    render(<Stats stats={{
      ...base,
      total: 5,
      failed: 5,
      failureRate: 1,
      buckets: [{ startSeconds: 0, count: 1 }, { startSeconds: 10, count: 4 }],
    }} />);
    expect(screen.getByRole('listitem', { name: '0–10 秒，1 人失败' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: '10–20 秒，4 人失败' })).toBeInTheDocument();
    expect(screen.getByText('0–10 秒')).toBeVisible();
    expect(screen.getByText('4 人')).toBeVisible();
  });
});

describe('Settlement forwarding', () => {
  const challenge: ChallengePayload = {
    v: 1,
    kind: 'challenge',
    video: {
      source: 'bilibili',
      bvid: 'BV1B7411m7LV',
      cid: 1,
      page: 1,
      title: '测试视频',
      description: '',
      cover: '',
      duration: 60,
    },
    initiator: '发起者',
    createdAt: 100,
    expiresAt: 200,
    nonce: 'nonce',
    mode: 'classic',
  };

  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState({}, '', '/c/public-token');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    history.replaceState({}, '', '/');
  });

  it('returns to the composer through SPA navigation and stores the source URL', () => {
    const pushState = vi.spyOn(history, 'pushState');
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');

    render(<Settlement challenge={challenge} result={{
      outcome: 'failed',
      elapsedSeconds: 12,
      reportUrl: 'https://example.com/report',
      stats: { total: 0, held: 0, failed: 0, failureRate: 0, averageElapsedSeconds: 0, buckets: [] },
    }} />);

    fireEvent.click(screen.getByRole('link', { name: '转发此挑战' }));

    expect(pushState).toHaveBeenCalledWith({}, '', '/');
    expect(window.location.pathname).toBe('/');
    expect(sessionStorage.getItem('forward-video')).toBe('https://www.bilibili.com/video/BV1B7411m7LV');
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'popstate' }));
  });

  it('downloads a settlement long image without navigating and keeps group image data aggregate-only', async () => {
    const pushState = vi.spyOn(history, 'pushState');
    render(<Settlement challenge={challenge} result={{
      outcome: 'held',
      elapsedSeconds: 60,
      reportUrl: 'https://example.com/report/br1.public',
      stats: { total: 4, held: 2, failed: 2, failureRate: .5, averageElapsedSeconds: 22, buckets: [] },
      scoreTrace: [{ timeSeconds: 0, score: 8 }],
      resultUrl: 'https://example.com/g/results/bgr1.public',
      groupTotal: 3,
      groupParticipants: [{ nickname: '不应进入长图', outcome: 'failed', elapsedSeconds: 4 }],
    }} />);

    fireEvent.click(screen.getByRole('button', { name: '下载结算长图' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '已下载结算长图' })).toBeInTheDocument());
    expect(shareMocks.createSettlementCard).toHaveBeenCalledWith(expect.objectContaining({
      publicUrl: 'https://example.com/g/results/bgr1.public',
      isGroup: true,
      groupTotal: 3,
    }));
    const cardInput = shareMocks.createSettlementCard.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
    expect(cardInput).toBeDefined();
    expect(cardInput).not.toHaveProperty('groupParticipants');
    expect(shareMocks.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), '绷绷炸弹-结算.png');
    expect(pushState).not.toHaveBeenCalled();
  });
});
