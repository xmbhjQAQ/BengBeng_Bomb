import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPreferredNickname, readPreferredNickname, rememberPreferredNickname } from './preferredNickname';

describe('preferred nickname storage', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('normalizes and remembers a valid nickname', () => {
    expect(rememberPreferredNickname('  小绷  ')).toBe(true);
    expect(readPreferredNickname()).toBe('小绷');
    clearPreferredNickname();
    expect(readPreferredNickname()).toBe('');
  });

  it('does not overwrite the saved nickname with empty or invalid input', () => {
    expect(rememberPreferredNickname('原昵称')).toBe(true);
    expect(rememberPreferredNickname('   ')).toBe(false);
    expect(rememberPreferredNickname('超'.repeat(21))).toBe(false);
    expect(readPreferredNickname()).toBe('原昵称');
  });

  it('removes corrupt and unsupported data safely', () => {
    localStorage.setItem('bengbeng:profile:v1', '{broken');
    expect(readPreferredNickname()).toBe('');
    expect(localStorage.getItem('bengbeng:profile:v1')).toBeNull();
    localStorage.setItem('bengbeng:profile:v1', JSON.stringify({ v: 2, nickname: '旧昵称' }));
    expect(readPreferredNickname()).toBe('');
  });

  it('degrades without losing the current interaction when writes fail', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(rememberPreferredNickname('小绷')).toBe(false);
  });
});
