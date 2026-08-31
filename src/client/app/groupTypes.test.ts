import { describe, expect, it } from 'vitest';
import { normalizeGroupComplete, normalizeGroupEntry, normalizeGroupManage, normalizeGroupOpen, normalizeGroupResults } from './groupTypes';

const stats = {
  total: 2,
  held: 1,
  failed: 1,
  failureRate: 0.5,
  averageElapsedSeconds: 31,
  buckets: [{ startSeconds: 10, count: 1 }],
};

describe('group result boundary normalizers', () => {
  it('keeps the public participant projection and cursor while dropping private fields', () => {
    const page = normalizeGroupResults({
      participants: [{
        attemptId: 'attempt-1',
        nickname: '  小明  ',
        outcome: 'failed',
        elapsedSeconds: 12,
        failedAtSeconds: 12,
        completedAt: 100,
        attemptToken: 'do-not-expose',
        scoreTrace: [{ timeSeconds: 1, score: 99 }],
        cameraFrame: 'private',
      }],
      nextCursor: 'cursor-2',
      stats,
      group: { state: 'active', expiresAt: 200, resultExpiresAt: 300 },
    });

    expect(page).toEqual({
      participants: [{
        attemptId: 'attempt-1',
        nickname: '小明',
        outcome: 'failed',
        elapsedSeconds: 12,
        failedAtSeconds: 12,
        completedAt: 100,
      }],
      nextCursor: 'cursor-2',
      stats,
      state: 'active',
      expiresAt: 200,
      resultExpiresAt: 300,
    });
    expect(JSON.stringify(page)).not.toContain('do-not-expose');
    expect(JSON.stringify(page)).not.toContain('cameraFrame');
  });

  it('normalizes legacy snake-case result fields and ignores malformed rows', () => {
    const page = normalizeGroupResults({
      results: [
        { id: 'a', name: 'Alice', outcome: 'held', seconds: 60, completed_at: 101 },
        { nickname: '', outcome: 'failed', elapsedSeconds: 3 },
        { nickname: 'bad-outcome', outcome: 'unknown', elapsedSeconds: 3 },
        { nickname: 'bad-time', outcome: 'failed', elapsedSeconds: -1 },
      ],
      next_cursor: '',
    });

    expect(page).toEqual({
      participants: [{
        attemptId: 'a',
        nickname: 'Alice',
        outcome: 'held',
        elapsedSeconds: 60,
        completedAt: 101,
      }],
      nextCursor: null,
    });
  });

  it('normalizes open and complete projections without requiring optional result pages', () => {
    const video = {
      source: 'bilibili' as const,
      bvid: 'BV1B7411m7LV',
      cid: 1,
      page: 1,
      title: '测试视频',
      description: '',
      cover: '',
      duration: 60,
    };
    const playback = { ...video, media: ['https://cdn.example/video.mp4'] };
    const opened = normalizeGroupOpen({
      challenge: { v: 1, kind: 'group-invitation', video, initiator: '发起者', message: '发到群里', createdAt: 1, expiresAt: 2, nonce: 'n', mode: 'group' },
      playback,
      stats,
      group: { group_id: 'group-1', state: 'active', created_at: 1, expires_at: 2 },
    });
    expect(opened.challenge).toMatchObject({ mode: 'group', initiator: '发起者', message: '发到群里' });
    expect(opened.playback).toEqual(playback);
    expect(opened.group).toEqual({ groupId: 'group-1', state: 'active', createdAt: 1, expiresAt: 2 });
    expect(opened.results).toMatchObject({ participants: [], stats });

    const completed = normalizeGroupComplete({ outcome: 'held', elapsedSeconds: 60, resultUrl: '/g/results/token', stats });
    expect(completed).toMatchObject({ outcome: 'held', elapsedSeconds: 60, resultUrl: '/g/results/token', stats, participants: [], nextCursor: null });
  });

  it('normalizes the shared group management projection and rejects incomplete summaries', () => {
    expect(normalizeGroupManage({
      status: 'ended',
      resultSummary: { total: 3, held: 1, failed: 2 },
      expires_at: 200,
      result_expires_at: 300,
      ended_at: 150,
    })).toEqual({
      status: 'ended',
      expiresAt: 200,
      resultExpiresAt: 300,
      endedAt: 150,
      summary: { total: 3, held: 1, failed: 2 },
    });
    expect(() => normalizeGroupManage({ status: 'active', summary: { total: 1, held: 2, failed: 0 } })).toThrow('群组管理状态无效');
  });

  it('normalizes the universal entry and keeps participation unavailable after expiry', () => {
    const video = {
      source: 'bilibili' as const,
      bvid: 'BV1B7411m7LV',
      cid: 1,
      page: 1,
      title: '入口视频',
      description: '',
      cover: '',
      duration: 60,
    };
    const entry = normalizeGroupEntry({
      entry: { state: 'expired', video, createdAt: 1, expiresAt: 2, resultExpiresAt: 3, canParticipate: true, initiator: '发起者' },
      invitationUrl: '/g/bg1.invitation',
      resultUrl: '/g/results/bgr1.result',
      resultPage: { state: 'expired', video, summary: { total: 1, held: 1, failed: 0 }, results: [] },
    });
    expect(entry).toMatchObject({ state: 'expired', canParticipate: false, resultUrl: '/g/results/bgr1.result', initiator: '发起者' });
  });

  it('rejects incomplete playback and completion projections instead of inventing a result', () => {
    const video = {
      source: 'bilibili' as const,
      bvid: 'BV1B7411m7LV',
      cid: 1,
      page: 1,
      title: '测试视频',
      description: '',
      cover: '',
      duration: 60,
    };
    expect(() => normalizeGroupOpen({ challenge: { v: 1, kind: 'group-invitation', video, createdAt: 1, expiresAt: 2, nonce: 'n', mode: 'group' }, playback: video })).toThrow('群组播放信息无效');
    expect(() => normalizeGroupComplete({ elapsedSeconds: 4 })).toThrow('群组结果内容无效');
  });
});
