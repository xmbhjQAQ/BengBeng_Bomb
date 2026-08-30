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
    expect(container.querySelector('.artplayer-host')).toHaveStyle({ aspectRatio: '720 / 1280' });
  });
});
