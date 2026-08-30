import { useCallback, useEffect, useRef, useState } from 'react';
import { cameraErrorStatus, openCamera } from './cameraService';
import type { CameraSession, CameraSettings, CameraStatus } from './types';

export function useCamera(settings: CameraSettings) {
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const sessionRef = useRef<CameraSession | null>(null);
  const requestGeneration = useRef(0);
  const mounted = useRef(true);

  const stop = useCallback(() => {
    requestGeneration.current += 1;
    sessionRef.current?.stop();
    sessionRef.current = null;
    setStream(null);
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    stop();
    const generation = requestGeneration.current;
    setStatus('requesting');
    try {
      const session = await openCamera(settings, () => {
        if (mounted.current && generation === requestGeneration.current) {
          setStatus('interrupted');
        }
      });
      if (!mounted.current || generation !== requestGeneration.current) {
        session.stop();
        return;
      }
      sessionRef.current = session;
      setStream(session.stream);
      setStatus('ready');
    } catch (error) {
      if (mounted.current && generation === requestGeneration.current) {
        setStatus(cameraErrorStatus(error));
      }
    }
  }, [settings, stop]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, []);

  return { status, stream, start, stop };
}
