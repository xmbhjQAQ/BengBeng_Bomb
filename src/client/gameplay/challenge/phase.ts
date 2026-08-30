import type { ChallengePhase, RecoverablePhase } from './types';

export const RECOVERABLE_PHASES: ReadonlyArray<RecoverablePhase> = [
  'running',
  'face-grace',
  'face-paused',
  'resume-stabilizing',
  'resume-countdown',
];

export const isActivePhase = (phase: ChallengePhase) =>
  phase === 'buffering' || RECOVERABLE_PHASES.includes(phase as RecoverablePhase);
