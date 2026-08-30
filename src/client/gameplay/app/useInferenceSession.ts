import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createCalibrationProfile, type CalibrationProfile } from '../calibration';
import {
  isActivePhase,
  type ChallengeEvent,
  type ChallengeState,
} from '../challenge';
import {
  startInferenceLoop,
  type FaceDetector,
  type FaceObservation,
} from '../detector';
import {
  evaluateObservation,
  initialScoringState,
  observationValidity,
  type ScoringState,
  type SmileSample,
} from '../scoring';
import { DEMO_CONFIG } from './config';
import type { LiveMetrics } from './types';

const initialMetrics = (): LiveMetrics => ({
  faceValidity: 'waiting',
  rawSignal: null,
  smoothedScore: null,
  videoTimeSeconds: null,
  inferenceMs: 0,
  effectiveFps: 0,
  skippedFrames: 0,
});

interface InferenceSessionInput {
  cameraElement: HTMLVideoElement | null;
  detector: FaceDetector | null;
  challenge: ChallengeState;
  challengeRef: RefObject<ChallengeState>;
  challengeVideo: HTMLVideoElement | null;
  dispatch(event: ChallengeEvent): void;
  onDetectorTerminated(): void;
}

export function useInferenceSession(input: InferenceSessionInput) {
  const {
    cameraElement,
    detector,
    challenge,
    challengeRef,
    challengeVideo,
    dispatch,
    onDetectorTerminated,
  } = input;
  const [profile, setProfile] = useState<CalibrationProfile | null>(null);
  const [calibrationIssue, setCalibrationIssue] = useState<CalibrationProfile['quality'] | null>(null);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [sample, setSample] = useState<SmileSample | null>(null);
  const [metrics, setMetrics] = useState<LiveMetrics>(initialMetrics);
  const profileRef = useRef<CalibrationProfile | null>(null);
  const calibrationObservations = useRef<FaceObservation[]>([]);
  const calibrationStartedAt = useRef<number | null>(null);
  const scoringRef = useRef<ScoringState>(initialScoringState());
  const maximumScore = useRef(0);
  const recentFrames = useRef<number[]>([]);

  const resetAll = useCallback(() => {
    profileRef.current = null;
    setProfile(null);
    setCalibrationIssue(null);
    setCalibrationProgress(0);
    calibrationObservations.current = [];
    calibrationStartedAt.current = null;
    scoringRef.current = initialScoringState();
    setSample(null);
    maximumScore.current = 0;
    recentFrames.current = [];
    setMetrics(initialMetrics());
  }, []);

  const beginCalibration = useCallback(() => {
    calibrationObservations.current = [];
    calibrationStartedAt.current = null;
    scoringRef.current = initialScoringState();
    profileRef.current = null;
    setProfile(null);
    setCalibrationIssue(null);
    setCalibrationProgress(0);
    dispatch({ type: 'CALIBRATION_STARTED' });
  }, [dispatch]);

  const beginChallenge = useCallback(() => {
    scoringRef.current = initialScoringState();
    maximumScore.current = 0;
    setSample(null);
    dispatch({ type: 'STARTED', now: performance.now() });
  }, [dispatch]);

  const restartChallenge = useCallback(() => {
    scoringRef.current = initialScoringState();
    maximumScore.current = 0;
    setSample(null);
    setMetrics(initialMetrics());
  }, []);

  const getProfile = useCallback(() => profileRef.current, []);
  const getMaximumScore = useCallback(() => maximumScore.current, []);

  useEffect(() => {
    const shouldRun =
      challenge.phase === 'calibrating' || isActivePhase(challenge.phase);
    if (!cameraElement || !detector || !shouldRun) return;

    return startInferenceLoop(
      cameraElement,
      detector,
      DEMO_CONFIG.detector.targetFps,
      {
        onResult: ({ observation, inferenceMs }) => {
          recentFrames.current.push(observation.timestamp);
          recentFrames.current = recentFrames.current.filter(
            (timestamp) => observation.timestamp - timestamp < 1_000,
          );
          const validity = observationValidity(observation, DEMO_CONFIG.scoring);
          setMetrics((current) => ({
            ...current,
            faceValidity: validity,
            videoTimeSeconds: challengeVideo?.currentTime ?? null,
            inferenceMs,
            effectiveFps: recentFrames.current.length,
          }));

          if (challengeRef.current.phase === 'calibrating') {
            calibrationStartedAt.current ??= observation.timestamp;
            calibrationObservations.current.push(observation);
            const elapsed = observation.timestamp - calibrationStartedAt.current;
            setCalibrationProgress(Math.min(1, elapsed / DEMO_CONFIG.calibration.durationMs));
            if (elapsed >= DEMO_CONFIG.calibration.durationMs) {
              const nextProfile = createCalibrationProfile(
                calibrationObservations.current,
                DEMO_CONFIG,
              );
              setProfile(nextProfile);
              profileRef.current = nextProfile.quality === 'good' ? nextProfile : null;
              setCalibrationIssue(nextProfile.quality === 'good' ? null : nextProfile.quality);
              dispatch({
                type:
                  nextProfile.quality === 'good'
                    ? 'CALIBRATION_READY'
                    : 'CALIBRATION_FAILED',
              });
            }
            return;
          }

          // A stalled player must not accumulate smile time while the media
          // clock is frozen. The challenge state machine restores its own
          // recovery timers when buffering ends.
          if (challengeRef.current.phase === 'buffering') return;

          const currentProfile = profileRef.current;
          if (!currentProfile || !isActivePhase(challengeRef.current.phase)) return;
          const next = evaluateObservation(
            scoringRef.current,
            observation,
            currentProfile,
            DEMO_CONFIG.scoring,
          );
          scoringRef.current = next.state;
          setSample(next.sample);
          setMetrics((current) => ({
            ...current,
            rawSignal: next.sample.rawSignal,
            smoothedScore: next.sample.smoothedScore,
          }));
          if (next.sample.valid) {
            maximumScore.current = Math.max(maximumScore.current, next.sample.smoothedScore ?? 0);
            dispatch({ type: 'FACE_VALID', now: observation.timestamp });
          } else {
            dispatch({ type: 'FACE_INVALID', now: observation.timestamp });
          }
          if (
            next.sample.classification === 'failed' &&
            challengeRef.current.phase === 'running'
          ) {
            dispatch({
              type: 'SMILE_FAILED',
              now: observation.timestamp,
              position: challengeVideo?.currentTime ?? 0,
              duration:
                challengeVideo && Number.isFinite(challengeVideo.duration)
                  ? challengeVideo.duration
                  : 0,
            });
          }
        },
        onSkippedFrame: () =>
          setMetrics((current) => ({
            ...current,
            skippedFrames: current.skippedFrames + 1,
          })),
        onTerminated: () => {
          onDetectorTerminated();
          dispatch({
            type: 'INVALIDATE',
            now: performance.now(),
            reason: 'detector-error',
          });
        },
      },
    );
  }, [
    cameraElement,
    challenge.phase,
    challengeRef,
    challengeVideo,
    detector,
    dispatch,
    onDetectorTerminated,
  ]);

  return {
    profile,
    calibrationIssue,
    calibrationProgress,
    sample,
    metrics,
    resetAll,
    beginCalibration,
    beginChallenge,
    restartChallenge,
    getProfile,
    getMaximumScore,
  };
}
