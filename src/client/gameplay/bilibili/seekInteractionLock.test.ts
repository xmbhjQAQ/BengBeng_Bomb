import { describe, expect, it, vi } from 'vitest';
import { installSeekInteractionLock } from './seekInteractionLock';

describe('installSeekInteractionLock', () => {
  it.each([
    'click',
    'mousedown',
    'pointerdown',
    'pointermove',
    'pointerup',
    'touchstart',
    'touchmove',
    'touchend',
    'touchcancel',
  ])(
    'blocks %s before ArtPlayer can seek',
    (eventName) => {
      const progress = document.createElement('div');
      const cleanup = installSeekInteractionLock(progress);
      const artPlayerHandler = vi.fn();
      progress.addEventListener(eventName, artPlayerHandler);
      const event = new Event(eventName, { bubbles: true, cancelable: true });

      progress.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(artPlayerHandler).not.toHaveBeenCalled();
      cleanup();
    },
  );
});
