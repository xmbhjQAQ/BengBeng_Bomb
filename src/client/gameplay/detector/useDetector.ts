import { useEffect, useRef, useState } from 'react';
import type { DemoConfig } from '../app/config';
import { createFaceDetector } from './mediapipeAdapter';
import type { DetectorStatus, FaceDetector } from './types';

export function useDetector(enabled: boolean, config: DemoConfig['detector'], retryKey: number) {
  const [status, setStatus] = useState<DetectorStatus>('idle');
  const [detector, setDetector] = useState<FaceDetector | null>(null);
  const current = useRef<FaceDetector | null>(null);

  useEffect(() => {
    if (!enabled) {
      current.current?.close();
      current.current = null;
      setDetector(null);
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    void createFaceDetector(config)
      .then((created) => {
        if (cancelled) {
          created.close();
          return;
        }
        current.current = created;
        setDetector(created);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
      current.current?.close();
      current.current = null;
      setDetector(null);
    };
  }, [enabled, config, retryKey]);

  return { status, detector };
}
