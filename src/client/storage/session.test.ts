import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSession, removeSession, writeSession } from './session';

describe('safe session storage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads and writes normal tab-scoped values', () => {
    expect(writeSession('safe-key', 'value')).toBe(true);
    expect(readSession('safe-key')).toBe('value');
    removeSession('safe-key');
    expect(readSession('safe-key')).toBeNull();
  });

  it('degrades when a privacy mode rejects storage operations', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    expect(readSession('blocked')).toBeNull();
    expect(writeSession('blocked', 'value')).toBe(false);
    expect(() => removeSession('blocked')).not.toThrow();
  });
});
