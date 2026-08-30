import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScoreTraceChart } from './ScoreTraceChart';
import { createChartModel } from './scoreTraceChartModel';

describe('ScoreTraceChart', () => {
  afterEach(cleanup);
  it('shows a truthful empty state', () => {
    render(<ScoreTraceChart points={[]} outcome="held" durationSeconds={60}/>);
    expect(screen.getByText(/没有足够的有效人脸样本/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders a constant single point and exposes touch/keyboard-readable detail', () => {
    render(<ScoreTraceChart points={[{ timeSeconds: 3.2, score: 44 }]} outcome="held" durationSeconds={10}/>);
    const point=screen.getByRole('button',{name:/3.2 秒，难绷程度 44/});
    fireEvent.focus(point);
    expect(screen.getByText('3.2 秒 · 难绷程度 44')).toBeVisible();
    expect(screen.getAllByText('挑战终点')).toHaveLength(2);
    expect(screen.getByText('10.0s')).toBeVisible();
  });

  it('marks a failed endpoint as an explosion and models long traces deterministically', () => {
    const points=Array.from({length:600},(_,index)=>({timeSeconds:index*12,score:index%101}));
    const model=createChartModel(points,7200);
    expect(model.points).toHaveLength(600);
    render(<ScoreTraceChart points={points} outcome="failed" durationSeconds={7200}/>);
    expect(screen.getByRole('button',{name:/爆炸点/})).toHaveClass('failed');
    expect(screen.getByText('爆炸点')).toBeVisible();
  });
});
