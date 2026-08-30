import type { CalibrationProfile } from '../calibration';
import type { DemoConfig } from '../app/config';
import type { FaceObservation } from '../detector';
import { composeSmileSignal, normalizedScore, observationValidity } from './signal';
import type { ScoringState, SmileSample } from './types';

export const initialScoringState = (): ScoringState => ({
  smoothedScore: 0,
  lastValidTimestamp: null,
  aboveThresholdSince: null,
  classification: 'neutral',
});

export function evaluateObservation(
  state: ScoringState,
  observation: FaceObservation,
  profile: CalibrationProfile,
  parameters: DemoConfig['scoring'],
): { state: ScoringState; sample: SmileSample } {
  const invalidReason = observationValidity(observation, parameters);
  if (invalidReason !== 'none') {
    return {
      state: { ...state, lastValidTimestamp: null, aboveThresholdSince: null },
      sample: {
        timestamp: observation.timestamp,
        valid: false,
        invalidReason,
        rawSignal: null,
        score: null,
        smoothedScore: null,
        thresholdElapsedMs: 0,
        classification: state.classification,
      },
    };
  }

  const rawSignal = composeSmileSignal(observation.features!);
  const score = normalizedScore(rawSignal, profile.baseline, parameters.sensitivity);
  const smoothedScore =
    state.lastValidTimestamp === null
      ? score
      : state.smoothedScore + parameters.smoothingAlpha * (score - state.smoothedScore);
  const aboveThresholdSince =
    smoothedScore >= parameters.failureThreshold
      ? (state.aboveThresholdSince ?? observation.timestamp)
      : null;
  const thresholdElapsedMs =
    aboveThresholdSince === null ? 0 : observation.timestamp - aboveThresholdSince;

  let classification = state.classification;
  if (classification !== 'failed') {
    if (thresholdElapsedMs >= parameters.sustainedMs) classification = 'failed';
    else if (smoothedScore >= parameters.dangerThreshold) classification = 'danger';
    else if (smoothedScore <= parameters.releaseThreshold) classification = 'neutral';
  }

  const nextState: ScoringState = {
    smoothedScore,
    lastValidTimestamp: observation.timestamp,
    aboveThresholdSince,
    classification,
  };
  return {
    state: nextState,
    sample: {
      timestamp: observation.timestamp,
      valid: true,
      invalidReason: 'none',
      rawSignal,
      score,
      smoothedScore,
      thresholdElapsedMs,
      classification,
    },
  };
}
