import { describe, expect, it } from 'vitest';
import { DEMO_CONFIG } from '../app/config';
import type { FaceObservation } from '../detector';
import { createCalibrationProfile } from './calibration';

const observation = (timestamp: number, smile = 0.05): FaceObservation => ({
  timestamp,
  faceCount: 1,
  confidence: 1,
  yaw: 0,
  roll: 0,
  features: { smile, cheekSquint: 0, mouthOpen: 0, mouthWidthRatio: 0.4 },
});

describe('createCalibrationProfile', () => {
  it('accepts enough stable neutral samples', () => {
    const samples = Array.from({ length: 30 }, (_, index) => observation(index * 70, 0.05));
    const profile = createCalibrationProfile(samples, DEMO_CONFIG);
    expect(profile.quality).toBe('good');
    expect(profile.sampleCount).toBe(30);
    expect(profile.deviation).toBe(0);
  });

  it('rejects an insufficient valid sample set', () => {
    const samples = Array.from({ length: 10 }, (_, index) => observation(index * 70));
    expect(createCalibrationProfile(samples, DEMO_CONFIG).quality).toBe('insufficient');
  });

  it('rejects an unstable calibration', () => {
    const samples = Array.from({ length: 30 }, (_, index) =>
      observation(index * 70, index % 2 === 0 ? 0 : 0.5),
    );
    expect(createCalibrationProfile(samples, DEMO_CONFIG).quality).toBe('unstable');
  });
});
