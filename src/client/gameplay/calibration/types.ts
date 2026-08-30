export interface CalibrationProfile {
  schemaVersion: 1;
  sampleCount: number;
  baseline: number;
  deviation: number;
  quality: 'good' | 'unstable' | 'insufficient';
}
