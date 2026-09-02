import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VideoMetadata } from '../../shared/contracts';
import { clearCreatedChallenges, readCreatedChallenges, removeCreatedChallenge, subscribeCreatedChallenges, upsertCreatedChallenge, type CreatedChallengeInput } from './createdChallenges';

const video: VideoMetadata = {
  source: 'bilibili', bvid: 'BV1234567890', cid: 1, page: 1, title: '测试视频',
  description: '说明', cover: 'https://example.com/cover.jpg', duration: 60,
};

function record(index: number, overrides: Partial<CreatedChallengeInput> = {}): CreatedChallengeInput {
  return {
    kind: 'classic', video, createdAt: 1_000 + index, expiresAt: 2_000 + index,
    challengeUrl: `https://bomb.example/c/token-${index}`,
    manageUrl: `https://bomb.example/manage#m=private-${index}`,
    initiator: '小绷',
    ...overrides,
  };
}

describe('created challenge history', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('stores all challenge kinds and orders the newest first', () => {
    expect(upsertCreatedChallenge(record(1))).toBe(true);
    expect(upsertCreatedChallenge(record(2, { kind: 'self' }))).toBe(true);
    expect(upsertCreatedChallenge(record(3, {
      kind: 'group', entryUrl: '/g/group-3', resultUrl: '/gr/result-3', resultExpiresAt: 3_000,
    }))).toBe(true);
    expect(readCreatedChallenges().map((item) => item.kind)).toEqual(['group', 'self', 'classic']);
  });

  it('upserts duplicates and keeps only the newest 50 records', () => {
    for (let index = 0; index < 51; index += 1) expect(upsertCreatedChallenge(record(index))).toBe(true);
    expect(readCreatedChallenges()).toHaveLength(50);
    expect(readCreatedChallenges().at(-1)?.challengeUrl).toContain('token-1');

    expect(upsertCreatedChallenge(record(60, { challengeUrl: 'https://bomb.example/c/token-25', manageUrl: '/manage#new-private' }))).toBe(true);
    const updated = readCreatedChallenges();
    expect(updated).toHaveLength(50);
    expect(updated[0]?.manageUrl).toBe('/manage#new-private');
  });

  it('isolates damaged records and rejects unsafe URLs', () => {
    const good = record(1);
    expect(upsertCreatedChallenge(good)).toBe(true);
    const raw = JSON.parse(localStorage.getItem('bengbeng:created-challenges:v1') || '{}') as { items: unknown[] };
    raw.items.push({ bad: true });
    localStorage.setItem('bengbeng:created-challenges:v1', JSON.stringify(raw));
    expect(readCreatedChallenges()).toHaveLength(1);
    expect(upsertCreatedChallenge(record(2, { manageUrl: 'javascript:alert(1)' }))).toBe(false);
  });

  it('supports remove, clear and change subscriptions', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCreatedChallenges(listener);
    upsertCreatedChallenge(record(1));
    const [saved] = readCreatedChallenges();
    expect(saved).toBeDefined();
    removeCreatedChallenge(saved!.id);
    upsertCreatedChallenge(record(2));
    clearCreatedChallenges();
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it('degrades when the browser refuses persistence', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(upsertCreatedChallenge(record(1))).toBe(false);
  });
});
