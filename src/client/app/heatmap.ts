import { CLIENT_CONFIG } from '../../shared/config/client';
import type { AggregateStats } from '../../shared/contracts';

export interface HeatmapBar {
  startSeconds: number;
  count: number;
  heightPercent: number;
  rangeLabel: string;
  accessibleLabel: string;
}

/** Produces visible, labelled bars without inventing data for empty buckets. */
export function createHeatmapBars(buckets: AggregateStats['buckets']): HeatmapBar[] {
  const valid = buckets.filter((bucket) =>
    Number.isFinite(bucket.startSeconds) && Number.isFinite(bucket.count) && bucket.count > 0,
  );
  const maxCount = Math.max(0, ...valid.map((bucket) => bucket.count));
  return valid.map((bucket) => {
    const endSeconds = bucket.startSeconds + CLIENT_CONFIG.heatmapBucketSeconds;
    const rangeLabel = `${bucket.startSeconds}–${endSeconds} 秒`;
    return {
      ...bucket,
      heightPercent: Math.max(12, (bucket.count / maxCount) * 100),
      rangeLabel,
      accessibleLabel: `${rangeLabel}，${bucket.count} 人失败`,
    };
  });
}
