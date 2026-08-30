export function installPlaybackGate(
  video: HTMLVideoElement,
  isAuthorized: () => boolean,
) {
  const originalPlay = video.play;
  const guardedPlay = () => {
    if (!isAuthorized()) return Promise.resolve();
    return originalPlay.call(video);
  };
  const stopUnauthorizedPlayback = () => {
    if (!isAuthorized() && !video.paused) video.pause();
  };

  video.play = guardedPlay;
  video.addEventListener('play', stopUnauthorizedPlayback, true);
  video.addEventListener('playing', stopUnauthorizedPlayback, true);

  return () => {
    video.removeEventListener('play', stopUnauthorizedPlayback, true);
    video.removeEventListener('playing', stopUnauthorizedPlayback, true);
    if (video.play === guardedPlay) video.play = originalPlay;
  };
}
