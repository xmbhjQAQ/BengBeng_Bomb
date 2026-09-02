import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLocal, removeLocal, subscribeLocal, writeLocal } from './local';

describe('safe local storage', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('reads, writes and removes persistent values', () => {
    expect(writeLocal('persistent-key', 'value')).toBe(true);
    expect(readLocal('persistent-key')).toBe('value');
    removeLocal('persistent-key');
    expect(readLocal('persistent-key')).toBeNull();
  });

  it('degrades when storage operations are rejected', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    expect(readLocal('blocked')).toBeNull();
    expect(writeLocal('blocked', 'value')).toBe(false);
    expect(() => removeLocal('blocked')).not.toThrow();
  });

  it('notifies same-page and cross-tab subscribers without including stored values', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLocal('watched', listener);
    writeLocal('watched', 'private-value');
    window.dispatchEvent(new StorageEvent('storage', { key: 'watched', newValue: 'another-private-value' }));
    writeLocal('other', 'ignored');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith();
    unsubscribe();
    removeLocal('watched');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('treats a cross-tab clear event as a change to every subscribed key', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLocal('watched', listener);
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
