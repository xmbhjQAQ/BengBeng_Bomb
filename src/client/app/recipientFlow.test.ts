import { describe, expect, it } from 'vitest';
import { recipientStage } from './recipientFlow';

const stage = (phase: Parameters<typeof recipientStage>[0]['phase'], overrides = {}) =>
  recipientStage({ accepted: true, phase, hasLocalResult: false, hasCompletedResult: false, ...overrides });

describe('recipientStage', () => {
  it('keeps consent ahead of calibration', () => {
    expect(recipientStage({ accepted: false, phase: 'preparing', hasLocalResult: false, hasCompletedResult: false })).toBe('consent');
    expect(stage('preparing')).toBe('calibration');
    expect(stage('calibrating')).toBe('calibration');
  });

  it('projects ready, active and invalid domain phases', () => {
    expect(stage('ready')).toBe('ready');
    expect(stage('running')).toBe('active');
    expect(stage('face-paused')).toBe('active');
    expect(stage('buffering')).toBe('active');
    expect(stage('invalid')).toBe('invalid');
  });

  it('projects local completion through submission to settlement', () => {
    expect(stage('failed')).toBe('submitting');
    expect(stage('completed', { hasLocalResult: true })).toBe('submitting');
    expect(stage('completed', { hasCompletedResult: true })).toBe('settlement');
  });
});
