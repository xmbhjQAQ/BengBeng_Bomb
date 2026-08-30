import { describe, expect, it } from 'vitest';
import type { CalibrationProfile } from '../calibration';
import { DEMO_CONFIG, normalizedConfig } from '../app/config';
import type { FaceObservation } from '../detector';
import { evaluateObservation, initialScoringState } from './engine';

const profile: CalibrationProfile = {
  schemaVersion: 1,
  sampleCount: 30,
  baseline: 0,
  deviation: 0,
  quality: 'good',
};
const parameters = { ...DEMO_CONFIG.scoring, smoothingAlpha: 1, sensitivity: 1 };
const valid = (timestamp: number, smile: number): FaceObservation => ({
  timestamp,
  faceCount: 1,
  confidence: 1,
  yaw: 0,
  roll: 0,
  features: { smile, cheekSquint: 0, mouthOpen: 0, mouthWidthRatio: 0.4 },
});

describe('evaluateObservation', () => {
  it('does not fail on an isolated score spike', () => {
    let state = initialScoringState();
    state = evaluateObservation(state, valid(0, 1), profile, parameters).state;
    const next = evaluateObservation(state, valid(100, 0), profile, parameters);
    expect(next.sample.classification).toBe('neutral');
    expect(next.sample.thresholdElapsedMs).toBe(0);
  });

  it('fails only after a sustained smile and stays terminal', () => {
    let state = initialScoringState();
    state = evaluateObservation(state, valid(0, 1), profile, parameters).state;
    const failed = evaluateObservation(state, valid(800, 1), profile, parameters);
    expect(failed.sample.classification).toBe('failed');
    const neutral = evaluateObservation(failed.state, valid(900, 0), profile, parameters);
    expect(neutral.sample.classification).toBe('failed');
  });

  it('resets sustained time when a frame is invalid', () => {
    let state = evaluateObservation(initialScoringState(), valid(0, 1), profile, parameters).state;
    state = evaluateObservation(
      state,
      { timestamp: 500, faceCount: 0, confidence: 0, yaw: 0, roll: 0 },
      profile,
      parameters,
    ).state;
    const next = evaluateObservation(state, valid(800, 1), profile, parameters);
    expect(next.sample.classification).not.toBe('failed');
    expect(next.sample.thresholdElapsedMs).toBe(0);
  });

  it('uses release hysteresis before returning to neutral', () => {
    const state = evaluateObservation(initialScoringState(), valid(0, 0.7), profile, parameters).state;
    const between = evaluateObservation(state, valid(100, 0.6), profile, parameters);
    expect(between.sample.classification).toBe('danger');
    const released = evaluateObservation(between.state, valid(200, 0.2), profile, parameters);
    expect(released.sample.classification).toBe('neutral');
  });
});

describe('normalizedConfig', () => {
  it('enforces release <= danger <= failure and numeric bounds', () => {
    const normalized = normalizedConfig({
      ...DEMO_CONFIG,
      scoring: {
        ...DEMO_CONFIG.scoring,
        releaseThreshold: 90,
        dangerThreshold: 80,
        failureThreshold: 50,
        smoothingAlpha: 2,
      },
    });
    expect(normalized.scoring.releaseThreshold).toBe(50);
    expect(normalized.scoring.dangerThreshold).toBe(50);
    expect(normalized.scoring.failureThreshold).toBe(50);
    expect(normalized.scoring.smoothingAlpha).toBe(1);
  });

  it('normalizes every externally adjustable numeric group, including non-finite input', () => {
    const normalized = normalizedConfig({
      ...DEMO_CONFIG,
      camera: { width: Number.NaN, height: -10 },
      detector: {
        ...DEMO_CONFIG.detector,
        targetFps: Number.POSITIVE_INFINITY,
        maxFaces: -1,
        minDetectionConfidence: 2,
        minPresenceConfidence: -1,
        minTrackingConfidence: Number.NaN,
      },
      calibration: {
        durationMs: Number.NaN,
        minimumSamples: -2,
        maximumDeviation: Number.NEGATIVE_INFINITY,
      },
      scoring: {
        ...DEMO_CONFIG.scoring,
        sustainedMs: Number.NaN,
        sensitivity: Number.NaN,
        minConfidence: 2,
        maxPoseDegrees: 999,
      },
      challenge: {
        faceGraceMs: -1,
        recoveryStableMs: Number.NaN,
        resumeCountdownMs: Number.NEGATIVE_INFINITY,
      },
      video: { metadataTimeoutMs: Number.NaN },
    });

    expect(normalized.camera).toEqual({ width: 1, height: 1 });
    expect(normalized.detector).toMatchObject({
      targetFps: 1,
      maxFaces: 2,
      minDetectionConfidence: 1,
      minPresenceConfidence: 0,
      minTrackingConfidence: 0,
    });
    expect(normalized.calibration).toEqual({
      durationMs: 250,
      minimumSamples: 1,
      maximumDeviation: 0,
    });
    expect(normalized.scoring).toMatchObject({
      sustainedMs: 0,
      sensitivity: 0.1,
      minConfidence: 1,
      maxPoseDegrees: 180,
    });
    expect(normalized.challenge).toEqual({
      faceGraceMs: 0,
      recoveryStableMs: 0,
      resumeCountdownMs: 0,
    });
    expect(normalized.video.metadataTimeoutMs).toBe(500);
  });
});
