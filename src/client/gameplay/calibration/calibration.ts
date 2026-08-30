import type { DemoConfig } from '../app/config';
import type { FaceObservation } from '../detector';
import { composeSmileSignal, observationValidity } from '../scoring';
import type { CalibrationProfile } from './types';

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

export function createCalibrationProfile(
  observations: FaceObservation[],
  config: DemoConfig,
): CalibrationProfile {
  const signals = observations
    .filter((observation) => observationValidity(observation, config.scoring) === 'none')
    .map((observation) => composeSmileSignal(observation.features!));

  if (signals.length < config.calibration.minimumSamples) {
    return {
      schemaVersion: 1,
      sampleCount: signals.length,
      baseline: 0,
      deviation: 0,
      quality: 'insufficient',
    };
  }

  const baseline = median(signals);
  const deviation = median(signals.map((signal) => Math.abs(signal - baseline)));
  return {
    schemaVersion: 1,
    sampleCount: signals.length,
    baseline,
    deviation,
    quality: deviation > config.calibration.maximumDeviation ? 'unstable' : 'good',
  };
}
