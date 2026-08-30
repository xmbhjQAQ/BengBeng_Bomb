import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResultPanel } from './ResultPanel';

describe('ResultPanel', () => {
  afterEach(cleanup);

  it('shows an immutable failed result and restart command', () => {
    const onRestart = vi.fn();
    render(<ResultPanel result={{
      schemaVersion: 1,
      outcome: 'failed',
      videoName: 'demo.mp4',
      failedAt: 2,
      videoPositionSeconds: 2,
      videoDurationSeconds: 10,
      validElapsedMs: 2_000,
      maximumSmoothedScore: 82,
      calibrationSampleCount: 30,
      calibrationQuality: 'good',
    }} onRestart={onRestart} />);
    expect(screen.getByRole('heading', { name: '🤣 没绷住' })).toBeInTheDocument();
    expect(screen.getByText('demo.mp4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再来一次' }));
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it('labels a completed challenge separately from a failed challenge', () => {
    render(<ResultPanel result={{
      schemaVersion: 1,
      outcome: 'completed',
      videoName: 'complete.webm',
      failedAt: null,
      videoPositionSeconds: 10,
      videoDurationSeconds: 10,
      validElapsedMs: 9_500,
      maximumSmoothedScore: 41,
      calibrationSampleCount: 28,
      calibrationQuality: 'good',
    }} onRestart={vi.fn()} />);
    expect(screen.getByRole('heading', { name: '😎 绷住了' })).toBeInTheDocument();
    expect(screen.queryByText('🤣 没绷住')).not.toBeInTheDocument();
  });
});
