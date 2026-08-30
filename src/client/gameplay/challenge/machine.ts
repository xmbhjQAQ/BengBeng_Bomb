import type { DemoConfig } from '../app/config';
import type { ChallengeEvent, ChallengeState, RecoverablePhase, Transition } from './types';

export const initialChallengeState = (): ChallengeState => ({
  phase: 'selecting',
  validElapsedMs: 0,
  activeSince: null,
  faceInvalidSince: null,
  faceValidSince: null,
  countdownEndsAt: null,
  bufferStartedAt: null,
  phaseBeforeBuffering: null,
  settlement: null,
  invalidReason: null,
});

const isTerminal = (state: ChallengeState) =>
  state.phase === 'failed' || state.phase === 'completed' || state.phase === 'invalid';

const stopClock = (state: ChallengeState, now: number): ChallengeState => ({
  ...state,
  validElapsedMs:
    state.validElapsedMs +
    (state.activeSince === null ? 0 : Math.max(0, now - state.activeSince)),
  activeSince: null,
});

export function transition(
  state: ChallengeState,
  event: ChallengeEvent,
  timings: DemoConfig['challenge'],
): Transition {
  if (event.type === 'RESTART') {
    return {
      state: { ...initialChallengeState(), phase: 'ready' },
      commands: ['reset-video'],
    };
  }
  if (isTerminal(state)) return { state, commands: [] };

  switch (event.type) {
    case 'VIDEO_SELECTED':
      return state.phase === 'selecting'
        ? { state: { ...state, phase: 'preparing' }, commands: [] }
        : { state, commands: [] };
    case 'CALIBRATION_STARTED':
      return state.phase === 'preparing'
        ? { state: { ...state, phase: 'calibrating' }, commands: [] }
        : { state, commands: [] };
    case 'CALIBRATION_READY':
      return state.phase === 'calibrating'
        ? { state: { ...state, phase: 'ready' }, commands: ['reset-video'] }
        : { state, commands: [] };
    case 'CALIBRATION_FAILED':
      return state.phase === 'calibrating'
        ? { state: { ...state, phase: 'preparing' }, commands: [] }
        : { state, commands: [] };
    case 'STARTED':
      return state.phase === 'ready'
        ? {
            state: { ...state, phase: 'running', activeSince: event.now },
            commands: ['reset-video', 'play-video'],
          }
        : { state, commands: [] };
    case 'FACE_INVALID':
      if (state.phase === 'running') {
        return {
          state: { ...stopClock(state, event.now), phase: 'face-grace', faceInvalidSince: event.now },
          commands: [],
        };
      }
      if (state.phase === 'resume-stabilizing' || state.phase === 'resume-countdown') {
        return {
          state: { ...state, phase: 'face-paused', faceValidSince: null, countdownEndsAt: null },
          commands: [],
        };
      }
      return { state, commands: [] };
    case 'FACE_VALID':
      if (state.phase === 'face-grace') {
        return {
          state: { ...state, phase: 'running', activeSince: event.now, faceInvalidSince: null },
          commands: [],
        };
      }
      if (state.phase === 'face-paused') {
        return {
          state: { ...state, phase: 'resume-stabilizing', faceValidSince: event.now },
          commands: [],
        };
      }
      return { state, commands: [] };
    case 'TICK':
      if (
        state.phase === 'face-grace' &&
        state.faceInvalidSince !== null &&
        event.now - state.faceInvalidSince >= timings.faceGraceMs
      ) {
        return { state: { ...state, phase: 'face-paused' }, commands: ['pause-video'] };
      }
      if (
        state.phase === 'resume-stabilizing' &&
        state.faceValidSince !== null &&
        event.now - state.faceValidSince >= timings.recoveryStableMs
      ) {
        return {
          state: {
            ...state,
            phase: 'resume-countdown',
            countdownEndsAt: event.now + timings.resumeCountdownMs,
          },
          commands: [],
        };
      }
      if (
        state.phase === 'resume-countdown' &&
        state.countdownEndsAt !== null &&
        event.now >= state.countdownEndsAt
      ) {
        return {
          state: { ...state, phase: 'running', activeSince: event.now, countdownEndsAt: null },
          commands: ['play-video'],
        };
      }
      if (state.phase === 'resume-countdown') return { state: { ...state }, commands: [] };
      return { state, commands: [] };
    case 'MEDIA_WAITING': {
      const recoverable = [
        'running',
        'face-grace',
        'face-paused',
        'resume-stabilizing',
        'resume-countdown',
      ].includes(state.phase);
      return recoverable
        ? {
            state: {
              ...stopClock(state, event.now),
              phase: 'buffering',
              bufferStartedAt: event.now,
              phaseBeforeBuffering: state.phase as RecoverablePhase,
            },
            commands: [],
          }
        : { state, commands: [] };
    }
    case 'MEDIA_PLAYING': {
      if (
        state.phase !== 'buffering' ||
        state.bufferStartedAt === null ||
        state.phaseBeforeBuffering === null
      ) {
        return { state, commands: [] };
      }
      const delta = Math.max(0, event.now - state.bufferStartedAt);
      const restored = state.phaseBeforeBuffering;
      return {
        state: {
          ...state,
          phase: restored,
          activeSince: restored === 'running' ? event.now : null,
          faceInvalidSince:
            state.faceInvalidSince === null ? null : state.faceInvalidSince + delta,
          faceValidSince: state.faceValidSince === null ? null : state.faceValidSince + delta,
          countdownEndsAt:
            state.countdownEndsAt === null ? null : state.countdownEndsAt + delta,
          bufferStartedAt: null,
          phaseBeforeBuffering: null,
        },
        commands: [],
      };
    }
    case 'SMILE_FAILED': {
      if (state.phase !== 'running') return { state, commands: [] };
      const stopped = stopClock(state, event.now);
      return {
        state: {
          ...stopped,
          phase: 'failed',
          settlement: {
            outcome: 'failed',
            failedAt: event.position,
            videoPositionSeconds: event.position,
            videoDurationSeconds: event.duration,
            validElapsedMs: stopped.validElapsedMs,
          },
        },
        commands: ['pause-video'],
      };
    }
    case 'VIDEO_ENDED': {
      if (state.phase !== 'running') return { state, commands: [] };
      const stopped = stopClock(state, event.now);
      return {
        state: {
          ...stopped,
          phase: 'completed',
          settlement: {
            outcome: 'completed',
            videoPositionSeconds: event.position,
            videoDurationSeconds: event.duration,
            validElapsedMs: stopped.validElapsedMs,
          },
        },
        commands: [],
      };
    }
    case 'INVALIDATE': {
      const stopped = stopClock(state, event.now);
      return {
        state: { ...stopped, phase: 'invalid', invalidReason: event.reason, settlement: null },
        commands: ['pause-video'],
      };
    }
  }
}
