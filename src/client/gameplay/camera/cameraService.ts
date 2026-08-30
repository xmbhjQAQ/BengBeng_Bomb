import type { CameraSession, CameraSettings, CameraStatus } from './types';

export async function openCamera(
  settings: CameraSettings,
  onInterrupted: () => void,
): Promise<CameraSession> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new Error('insecure-context');
  }
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: settings.width },
      height: { ideal: settings.height },
      facingMode: 'user',
    },
  });
  const tracks = stream.getVideoTracks();
  if (tracks.length === 0) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('unavailable');
  }
  tracks.forEach((track) => track.addEventListener('ended', onInterrupted, { once: true }));
  return {
    stream,
    stop: () => stream.getTracks().forEach((track) => track.stop()),
  };
}

export function cameraErrorStatus(error: unknown): Extract<
  CameraStatus,
  'denied' | 'insecure-context' | 'unavailable' | 'unsupported'
> {
  if (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'SecurityError')
  ) {
    return 'denied';
  }
  if (error instanceof Error && error.message === 'insecure-context') return 'insecure-context';
  if (error instanceof Error && error.message === 'unsupported') return 'unsupported';
  return 'unavailable';
}
