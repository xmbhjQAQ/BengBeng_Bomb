export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'ready'
  | 'denied'
  | 'insecure-context'
  | 'unavailable'
  | 'interrupted'
  | 'unsupported';

export interface CameraSettings {
  width: number;
  height: number;
}

export interface CameraSession {
  stream: MediaStream;
  stop(): void;
}
