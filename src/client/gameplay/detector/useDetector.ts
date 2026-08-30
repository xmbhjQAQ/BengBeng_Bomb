import { useEffect, useRef, useState } from 'react';
import type { DemoConfig } from '../app/config';
import { createFaceDetector, detectorErrorMessage } from './mediapipeAdapter';
import type { DetectorStatus, FaceDetector } from './types';

interface PendingDetector {
  promise: Promise<FaceDetector>;
  consumers: number;
  detector: FaceDetector | null;
  closed: boolean;
}

export function useDetector(enabled: boolean, config: DemoConfig['detector'], retryKey: number) {
  const [status, setStatus] = useState<DetectorStatus>('idle');
  const [detector, setDetector] = useState<FaceDetector | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<FaceDetector | null>(null);
  const pending = useRef<PendingDetector | null>(null);

  useEffect(() => {
    if (!enabled) {
      current.current?.close();
      current.current = null;
      setDetector(null);
      setStatus('idle');
      setError(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setError(null);

    let request = pending.current;
    if (!request) {
      request = {
        promise: createFaceDetector(config),
        consumers: 0,
        detector: null,
        closed: false,
      };
      pending.current = request;
      const createdRequest = request;
      void createdRequest.promise.then(
        (created) => { createdRequest.detector = created; },
        () => undefined,
      ).finally(() => {
        if (pending.current === createdRequest) pending.current = null;
      });
    }
    request.consumers += 1;

    void request.promise
      .then((created) => {
        if (cancelled) return;
        current.current = created;
        setDetector(created);
        setStatus('ready');
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        const message = detectorErrorMessage(caught);
        console.error('[face-detector]', message);
        setError(message);
        setStatus('error');
      });
    return () => {
      cancelled = true;
      request.consumers -= 1;
      if (
        request.consumers === 0 &&
        request.detector !== null &&
        current.current === request.detector &&
        !request.closed
      ) {
        request.closed = true;
        current.current.close();
        current.current = null;
      } else if (request.consumers === 0 && !request.closed) {
        void request.promise.then((created) => {
          if (request.consumers === 0 && !request.closed) {
            request.closed = true;
            created.close();
          }
        }, () => undefined);
      }
      setDetector(null);
    };
  }, [enabled, config, retryKey]);

  return { status, detector, error };
}
