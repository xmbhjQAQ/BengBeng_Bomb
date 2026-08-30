import { formatDuration, formatNumber, formatScore, t } from '../i18n';
import type { LocalChallengeResult } from './types';

interface ResultPanelProps {
  result: LocalChallengeResult;
  onRestart: () => void;
}

export function ResultPanel({ result, onRestart }: ResultPanelProps) {
  const failed = result.outcome === 'failed';
  return (
    <section className="section result" aria-live="polite">
      <h2>{failed ? t.result.failed : t.result.completed}</h2>
      <dl className="result-grid">
        <div><dt>{t.result.video}</dt><dd>{result.videoName}</dd></div>
        <div><dt>{t.result.failedAt}</dt><dd>{result.failedAt === null ? '—' : formatDuration(result.failedAt * 1000)}</dd></div>
        <div><dt>{t.result.position}</dt><dd>{formatDuration(result.videoPositionSeconds * 1000)}</dd></div>
        <div><dt>{t.result.validTime}</dt><dd>{formatDuration(result.validElapsedMs)}</dd></div>
        <div><dt>{t.result.maximumScore}</dt><dd>{formatScore(result.maximumSmoothedScore)}</dd></div>
        <div><dt>{t.result.calibrationSamples}</dt><dd>{formatNumber(result.calibrationSampleCount, 0)}</dd></div>
      </dl>
      <button type="button" onClick={onRestart}>{t.result.restart}</button>
    </section>
  );
}
