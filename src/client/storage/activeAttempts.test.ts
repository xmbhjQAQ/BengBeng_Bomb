import { afterEach, describe, expect, it, vi } from 'vitest';
import { readActiveAttempt, removeActiveAttempt, subscribeActiveAttempts, writeActiveAttempt } from './activeAttempts';

const now = 10_000;

describe('active attempt storage', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips single and group attempt credentials by exact route identity', () => {
    expect(writeActiveAttempt({ kind: 'single', challengeToken: 'single-token', attemptToken: 'single-attempt', startedAt: Date.now() / 1000, expiresAt: Date.now() / 1000 + 3600 })).toBe(true);
    expect(writeActiveAttempt({ kind: 'group', challengeToken: 'group-token', attemptToken: 'group-attempt', attemptId: 'attempt-id', nickname: '  群友  ', startedAt: Date.now() / 1000, expiresAt: Date.now() / 1000 + 3600 })).toBe(true);
    expect(readActiveAttempt('single', 'single-token')?.attemptToken).toBe('single-attempt');
    const group = readActiveAttempt('group', 'group-token');
    expect(group?.kind).toBe('group');
    expect(group?.kind === 'group' && group.nickname).toBe('群友');
    expect(readActiveAttempt('single', 'group-token')).toBeNull();
  });

  it('rejects incomplete group records and removes expired records lazily', () => {
    expect(writeActiveAttempt({ kind: 'group', challengeToken: 'group', attemptToken: 'attempt', attemptId: '', nickname: '群友', startedAt: Date.now() / 1000, expiresAt: Date.now() / 1000 + 3600 })).toBe(false);
    localStorage.setItem('bengbeng:active-attempts:v1', JSON.stringify({
      v: 1,
      items: [
        { kind: 'single', challengeToken: 'expired', attemptToken: 'secret', startedAt: 1, expiresAt: now - 1 },
        { kind: 'single', challengeToken: 'current', attemptToken: 'secret-2', startedAt: now - 2, expiresAt: now + 10 },
      ],
    }));
    expect(readActiveAttempt('single', 'expired', now)).toBeNull();
    expect(readActiveAttempt('single', 'current', now)?.attemptToken).toBe('secret-2');
    expect(localStorage.getItem('bengbeng:active-attempts:v1')).not.toContain('expired');
  });

  it('keeps a migrated group attempt when its legacy nickname is unavailable', () => {
    localStorage.setItem('bengbeng:active-attempts:v1', JSON.stringify({
      v: 1,
      items: [{ kind: 'group', challengeToken: 'legacy-group', attemptToken: 'attempt', attemptId: 'attempt-id', startedAt: now - 2, expiresAt: now + 10 }],
    }));
    expect(readActiveAttempt('group', 'legacy-group', now)).toMatchObject({
      attemptToken: 'attempt',
      attemptId: 'attempt-id',
    });
    const legacy = readActiveAttempt('group', 'legacy-group', now);
    expect(legacy?.kind === 'group' ? legacy.nickname : undefined).toBeUndefined();
  });

  it('upserts, removes and notifies without returning credentials to listeners', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeActiveAttempts(listener);
    const first = { kind: 'single' as const, challengeToken: 'challenge', attemptToken: 'old', startedAt: Date.now() / 1000, expiresAt: Date.now() / 1000 + 3600 };
    expect(writeActiveAttempt(first)).toBe(true);
    expect(writeActiveAttempt({ ...first, attemptToken: 'new', startedAt: first.startedAt + 1 })).toBe(true);
    expect(readActiveAttempt('single', 'challenge')?.attemptToken).toBe('new');
    removeActiveAttempt('single', 'challenge');
    expect(readActiveAttempt('single', 'challenge')).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenCalledWith();
    unsubscribe();
  });

  it('does not let a stale tab remove a replacement attempt for the same group', () => {
    const base = {
      kind: 'group' as const,
      challengeToken: 'shared-group',
      attemptId: 'new-id',
      nickname: '新参与者',
      startedAt: Date.now() / 1000,
      expiresAt: Date.now() / 1000 + 3600,
    };
    expect(writeActiveAttempt({ ...base, attemptToken: 'new-attempt' })).toBe(true);
    removeActiveAttempt('group', 'shared-group', 'old-attempt');
    expect(readActiveAttempt('group', 'shared-group')?.attemptToken).toBe('new-attempt');
    removeActiveAttempt('group', 'shared-group', 'new-attempt');
    expect(readActiveAttempt('group', 'shared-group')).toBeNull();
  });

  it('isolates malformed envelopes and degrades on quota errors', () => {
    localStorage.setItem('bengbeng:active-attempts:v1', '{broken');
    expect(readActiveAttempt('single', 'challenge')).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(writeActiveAttempt({ kind: 'single', challengeToken: 'challenge', attemptToken: 'attempt', startedAt: Date.now() / 1000, expiresAt: Date.now() / 1000 + 3600 })).toBe(false);
  });
});
