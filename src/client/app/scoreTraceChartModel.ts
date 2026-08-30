import { CLIENT_CONFIG } from '../../shared/config/client';
import type { ScorePoint } from '../../shared/contracts';

export const SCORE_CHART = { width: 720, height: 260, left: 48, right: 22, top: 20, bottom: 38 } as const;

export function scoreY(score: number) {
  return SCORE_CHART.top + (100 - score) / 100 * (SCORE_CHART.height-SCORE_CHART.top-SCORE_CHART.bottom);
}

export function scoreX(timeSeconds: number, maxTime: number) {
  return SCORE_CHART.left + timeSeconds / maxTime * (SCORE_CHART.width-SCORE_CHART.left-SCORE_CHART.right);
}

export function createChartModel(points: readonly ScorePoint[], durationSeconds: number) {
  const normalized = points
    .filter((point) => Number.isFinite(point.timeSeconds) && Number.isFinite(point.score) && point.timeSeconds >= 0)
    .map((point) => ({ timeSeconds: point.timeSeconds, score: Math.min(100, Math.max(0, Math.round(point.score))) }))
    .sort((a, b) => a.timeSeconds-b.timeSeconds);
  const maxTime = Math.max(1, durationSeconds, normalized.at(-1)?.timeSeconds ?? 0);
  const plotted = normalized.map((point) => ({ ...point, x: scoreX(point.timeSeconds, maxTime), y: scoreY(point.score) }));
  return {
    points: plotted,
    maxTime,
    polyline: plotted.map((point) => `${point.x},${point.y}`).join(' '),
    dangerCount: plotted.filter((point) => point.score >= CLIENT_CONFIG.scoring.dangerThreshold).length,
  };
}
