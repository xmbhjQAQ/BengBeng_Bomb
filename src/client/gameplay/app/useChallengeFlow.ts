import { useCallback, useRef, useState } from 'react';
import {
  initialChallengeState,
  transition,
  type ChallengeCommand,
  type ChallengeEvent,
  type ChallengeState,
} from '../challenge';
import { DEMO_CONFIG } from './config';

interface MediaCommands {
  pause(): void;
  reset(): void;
  play(): Promise<void>;
}

export function useChallengeFlow(media: MediaCommands) {
  const [state, setState] = useState<ChallengeState>(initialChallengeState);
  const stateRef = useRef(state);
  const dispatchRef = useRef<(event: ChallengeEvent) => void>(() => undefined);

  const execute = useCallback((commands: ChallengeCommand[]) => {
    for (const command of commands) {
      if (command === 'pause-video') media.pause();
      if (command === 'reset-video') media.reset();
      if (command === 'play-video') {
        void media.play().catch(() => {
          dispatchRef.current({
            type: 'INVALIDATE',
            now: performance.now(),
            reason: 'play-rejected',
          });
        });
      }
    }
  }, [media]);

  const dispatch = useCallback((event: ChallengeEvent) => {
    const next = transition(stateRef.current, event, DEMO_CONFIG.challenge);
    stateRef.current = next.state;
    setState(next.state);
    execute(next.commands);
  }, [execute]);
  dispatchRef.current = dispatch;

  const resetToSelecting = useCallback(() => {
    const initial = initialChallengeState();
    stateRef.current = initial;
    setState(initial);
  }, []);

  return { state, stateRef, dispatch, resetToSelecting };
}
