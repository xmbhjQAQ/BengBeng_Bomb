import { describe, expect, it } from 'vitest';
import { DEMO_CONFIG } from '../app/config';
import { initialChallengeState, transition } from './machine';

const timings = DEMO_CONFIG.challenge;
const readyState = () => {
  let state = transition(initialChallengeState(), { type: 'VIDEO_SELECTED' }, timings).state;
  state = transition(state, { type: 'CALIBRATION_STARTED' }, timings).state;
  return transition(state, { type: 'CALIBRATION_READY' }, timings).state;
};

describe('challenge transition', () => {
  it('resets the local video before every explicit challenge start', () => {
    const started = transition(readyState(), { type: 'STARTED', now: 0 }, timings);
    expect(started.state.phase).toBe('running');
    expect(started.commands).toEqual(['reset-video', 'play-video']);
  });

  it('pauses after face grace and resumes after stabilization/countdown', () => {
    let state = transition(readyState(), { type: 'STARTED', now: 0 }, timings).state;
    state = transition(state, { type: 'FACE_INVALID', now: 100 }, timings).state;
    const paused = transition(state, { type: 'TICK', now: 700 }, timings);
    expect(paused.state.phase).toBe('face-paused');
    expect(paused.commands).toEqual(['pause-video']);
    state = transition(paused.state, { type: 'FACE_VALID', now: 800 }, timings).state;
    state = transition(state, { type: 'TICK', now: 1_900 }, timings).state;
    expect(state.phase).toBe('resume-countdown');
    const resumed = transition(state, { type: 'TICK', now: 5_000 }, timings);
    expect(resumed.state.phase).toBe('running');
    expect(resumed.commands).toEqual(['play-video']);
  });

  it('settles failure once and ignores later completion', () => {
    let state = transition(readyState(), { type: 'STARTED', now: 0 }, timings).state;
    state = transition(
      state,
      { type: 'SMILE_FAILED', now: 1_000, position: 1, duration: 10 },
      timings,
    ).state;
    const later = transition(
      state,
      { type: 'VIDEO_ENDED', now: 2_000, position: 10, duration: 10 },
      timings,
    );
    expect(later.state).toBe(state);
    expect(later.state.settlement?.outcome).toBe('failed');
    expect(later.state.settlement?.failedAt).toBe(1);
  });

  it('completes normally and restart clears the terminal result', () => {
    let state = transition(readyState(), { type: 'STARTED', now: 0 }, timings).state;
    state = transition(
      state,
      { type: 'VIDEO_ENDED', now: 2_000, position: 2, duration: 2 },
      timings,
    ).state;
    expect(state.settlement?.outcome).toBe('completed');
    const restarted = transition(state, { type: 'RESTART' }, timings);
    expect(restarted.state.phase).toBe('ready');
    expect(restarted.state.settlement).toBeNull();
  });

  it('freezes recovery timers while media is buffering', () => {
    let state = transition(readyState(), { type: 'STARTED', now: 0 }, timings).state;
    state = transition(state, { type: 'FACE_INVALID', now: 100 }, timings).state;
    state = transition(state, { type: 'MEDIA_WAITING', now: 200 }, timings).state;
    const restored = transition(state, { type: 'MEDIA_PLAYING', now: 1_200 }, timings).state;
    expect(restored.phase).toBe('face-grace');
    expect(restored.faceInvalidSince).toBe(1_100);
  });

  it('invalidates active playback once and keeps invalid state terminal', () => {
    let state = transition(readyState(), { type: 'STARTED', now: 0 }, timings).state;
    const invalid = transition(
      state,
      { type: 'INVALIDATE', now: 400, reason: 'unexpected-pause' },
      timings,
    );
    expect(invalid.state.phase).toBe('invalid');
    expect(invalid.state.validElapsedMs).toBe(400);
    expect(invalid.commands).toEqual(['pause-video']);

    state = transition(invalid.state, { type: 'FACE_VALID', now: 500 }, timings).state;
    expect(state).toBe(invalid.state);
  });

  it('returns to face-paused when recovery becomes invalid during countdown', () => {
    let state = transition(readyState(), { type: 'STARTED', now: 0 }, timings).state;
    state = transition(state, { type: 'FACE_INVALID', now: 100 }, timings).state;
    state = transition(state, { type: 'TICK', now: 700 }, timings).state;
    state = transition(state, { type: 'FACE_VALID', now: 800 }, timings).state;
    state = transition(state, { type: 'TICK', now: 1_900 }, timings).state;
    expect(state.phase).toBe('resume-countdown');

    state = transition(state, { type: 'FACE_INVALID', now: 2_000 }, timings).state;
    expect(state.phase).toBe('face-paused');
    expect(state.countdownEndsAt).toBeNull();
  });
});
