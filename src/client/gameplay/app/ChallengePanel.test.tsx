import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChallengePanel } from './ChallengePanel';

describe('ChallengePanel responsive player', () => {
  it('uses a centered portrait aspect ratio for vertical videos', () => {
    const { container } = render(
      <ChallengePanel
        hasVideo
        dimension={{ width: 720, height: 1280 }}
        phase="preparing"
        canStart={false}
        sample={null}
        countdownSeconds={null}
        playerError={null}
        danmakuStatus="unavailable"
        setPlayerContainer={vi.fn()}
        onStart={vi.fn()}
      />,
    );

    expect(container.querySelector('.portrait-player')).toBeInTheDocument();
    expect(container.querySelector('.player-shell')).toHaveClass('player-locked');
    expect(container.querySelector('.player-shell')).toHaveAttribute('aria-disabled', 'true');
    expect(container.querySelector('.player-shell')).toHaveAttribute('inert');
    expect(container.querySelector('.artplayer-host')).toHaveStyle({ aspectRatio: '720 / 1280' });
  });

  it('unlocks player interaction only during the active challenge', () => {
    const { container } = render(
      <ChallengePanel
        hasVideo
        phase="running"
        canStart={false}
        sample={null}
        countdownSeconds={null}
        playerError={null}
        danmakuStatus="unavailable"
        setPlayerContainer={vi.fn()}
        onStart={vi.fn()}
      />,
    );

    expect(container.querySelector('.player-shell')).toHaveClass('player-active');
    expect(container.querySelector('.player-shell')).not.toHaveClass('player-locked');
    expect(container.querySelector('.player-shell')).toHaveAttribute('aria-disabled', 'false');
    expect(container.querySelector('.player-shell')).not.toHaveAttribute('inert');
  });
});
