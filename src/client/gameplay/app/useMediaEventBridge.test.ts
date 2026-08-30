import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialChallengeState } from '../challenge';
import { useMediaEventBridge } from './useMediaEventBridge';

describe('useMediaEventBridge', () => {
  it('does not invalidate an active challenge when a seeking event slips through', () => {
    const consumeSeek = vi.fn(() => false);
    const dispatch = vi.fn();
    const challengeRef = {
      current: { ...initialChallengeState(), phase: 'running' as const },
    };
    const { result } = renderHook(() => useMediaEventBridge(
      null,
      () => false,
      consumeSeek,
      challengeRef,
      dispatch,
    ));

    act(() => result.current.onSeeking());

    expect(consumeSeek).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
