import type { ChallengePhase } from '../gameplay/challenge';

export type RecipientStage =
  | 'consent'
  | 'calibration'
  | 'ready'
  | 'active'
  | 'invalid'
  | 'submitting'
  | 'settlement';

const ACTIVE_PHASES: ChallengePhase[] = [
  'running',
  'face-grace',
  'face-paused',
  'resume-stabilizing',
  'resume-countdown',
  'buffering',
];

/**
 * Maps domain-owned challenge state to the one visible recipient step.
 * This is deliberately a projection rather than a second state machine.
 */
export function recipientStage(input: {
  accepted: boolean;
  phase: ChallengePhase;
  hasLocalResult: boolean;
  hasCompletedResult: boolean;
}): RecipientStage {
  if (input.hasCompletedResult) return 'settlement';
  if (!input.accepted) return 'consent';
  if (input.hasLocalResult || input.phase === 'failed' || input.phase === 'completed') {
    return 'submitting';
  }
  if (input.phase === 'invalid') return 'invalid';
  if (ACTIVE_PHASES.includes(input.phase)) return 'active';
  if (input.phase === 'ready') return 'ready';
  return 'calibration';
}

export const RECIPIENT_STEPS = [
  { stage: 'consent', label: '了解挑战' },
  { stage: 'calibration', label: '人脸校准' },
  { stage: 'ready', label: '准备开始' },
  { stage: 'active', label: '正式挑战' },
  { stage: 'submitting', label: '提交结果' },
  { stage: 'settlement', label: '挑战结算' },
] as const;
