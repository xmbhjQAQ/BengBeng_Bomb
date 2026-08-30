import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Stats } from './Settlement';

const base = { total: 0, held: 0, failed: 0, failureRate: 0, averageElapsedSeconds: 0 };

describe('Stats', () => {
  it('shows an explicit empty state without fake bars', () => {
    render(<Stats stats={{ ...base, buckets: [] }} />);
    expect(screen.getByText(/还没有失败时间数据/)).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('renders readable time ranges and counts for every bucket', () => {
    render(<Stats stats={{
      ...base,
      total: 5,
      failed: 5,
      failureRate: 1,
      buckets: [{ startSeconds: 0, count: 1 }, { startSeconds: 10, count: 4 }],
    }} />);
    expect(screen.getByRole('listitem', { name: '0–10 秒，1 人失败' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: '10–20 秒，4 人失败' })).toBeInTheDocument();
    expect(screen.getByText('0–10 秒')).toBeVisible();
    expect(screen.getByText('4 人')).toBeVisible();
  });
});
