const blockedSeekEvents = [
  'click',
  'dblclick',
  'mousedown',
  'pointerdown',
  'pointermove',
  'pointerup',
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
] as const;

export function installSeekInteractionLock(progress: HTMLElement) {
  const blockSeekInteraction = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  blockedSeekEvents.forEach((eventName) => {
    progress.addEventListener(eventName, blockSeekInteraction, true);
  });

  return () => {
    blockedSeekEvents.forEach((eventName) => {
      progress.removeEventListener(eventName, blockSeekInteraction, true);
    });
  };
}
