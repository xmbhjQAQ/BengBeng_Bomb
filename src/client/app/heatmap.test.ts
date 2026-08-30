import { describe, expect, it } from 'vitest';
import { createHeatmapBars } from './heatmap';

describe('createHeatmapBars', () => {
  it('keeps empty stats empty and drops non-positive buckets', () => {
    expect(createHeatmapBars([])).toEqual([]);
    expect(createHeatmapBars([{ startSeconds: 0, count: 0 }])).toEqual([]);
  });

  it('normalizes one and multiple buckets against the largest count', () => {
    expect(createHeatmapBars([{ startSeconds: 10, count: 999 }])[0]?.heightPercent).toBe(100);
    const bars = createHeatmapBars([
      { startSeconds: 0, count: 1 },
      { startSeconds: 10, count: 4 },
      { startSeconds: 20, count: 4 },
    ]);
    expect(bars.map((bar) => bar.heightPercent)).toEqual([25, 100, 100]);
    expect(bars[0]?.rangeLabel).toBe('0–10 秒');
    expect(bars[1]?.accessibleLabel).toBe('10–20 秒，4 人失败');
  });

  it('uses a non-zero minimum for very small buckets', () => {
    expect(createHeatmapBars([
      { startSeconds: 0, count: 1 },
      { startSeconds: 10, count: 10_000 },
    ])[0]?.heightPercent).toBe(12);
  });
});
