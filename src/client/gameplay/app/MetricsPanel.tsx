import type { ChallengePhase } from '../challenge';
import { formatDuration, formatMilliseconds, formatNumber, formatScore, t } from '../i18n';
import type { LiveMetrics } from './types';
import { faceValidityText, phaseText } from './viewText';

interface MetricsPanelProps {
  phase: ChallengePhase;
  metrics: LiveMetrics;
}

export function MetricsPanel({ phase, metrics }: MetricsPanelProps) {
  const value = (input: number | null, formatter: (number: number) => string) =>
    input === null ? '—' : formatter(input);
  return (
    <details className="section metrics" open>
      <summary>{t.metrics.title}</summary>
      <dl className="metrics-grid">
        <div><dt>{t.metrics.phase}</dt><dd>{phaseText(phase)}</dd></div>
        <div><dt>{t.metrics.face}</dt><dd>{faceValidityText(metrics.faceValidity)}</dd></div>
        <div><dt>{t.metrics.raw}</dt><dd>{value(metrics.rawSignal, (number) => formatNumber(number, 3))}</dd></div>
        <div><dt>{t.metrics.smoothed}</dt><dd>{value(metrics.smoothedScore, formatScore)}</dd></div>
        <div><dt>{t.metrics.videoTime}</dt><dd>{value(metrics.videoTimeSeconds, (number) => formatDuration(number * 1_000))}</dd></div>
        <div><dt>{t.metrics.inference}</dt><dd>{formatMilliseconds(metrics.inferenceMs)}</dd></div>
        <div><dt>{t.metrics.fps}</dt><dd>{formatNumber(metrics.effectiveFps, 0)}</dd></div>
        <div><dt>{t.metrics.skipped}</dt><dd>{formatNumber(metrics.skippedFrames, 0)}</dd></div>
      </dl>
    </details>
  );
}
