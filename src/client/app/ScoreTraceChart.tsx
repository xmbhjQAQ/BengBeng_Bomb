import { useMemo, useState } from 'react';
import { CLIENT_CONFIG } from '../../shared/config/client';
import type { ScorePoint } from '../../shared/contracts';
import { createChartModel, SCORE_CHART, scoreX, scoreY } from './scoreTraceChartModel';

export function ScoreTraceChart({
  points,
  outcome,
  durationSeconds,
}: {
  points: readonly ScorePoint[];
  outcome: 'held' | 'failed';
  durationSeconds: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const model = useMemo(() => createChartModel(points, durationSeconds), [durationSeconds, points]);
  if (!model.points.length) {
    return (
      <section className="section score-trace-section" aria-labelledby="score-trace-title">
        <h2 id="score-trace-title">本次表情变化</h2>
        <p className="muted score-trace-empty">本次没有足够的有效人脸样本，无法绘制变化曲线。</p>
      </section>
    );
  }
  const peak = model.points.reduce((best, point) => point.score > best.score ? point : best);
  const active = selected === null ? model.points.at(-1)! : model.points[selected]!;
  const markerLabel = outcome === 'failed' ? '爆炸点' : '挑战终点';
  const markerTime = outcome === 'failed' ? model.points.at(-1)!.timeSeconds : durationSeconds;
  return (
    <section className="section score-trace-section" aria-labelledby="score-trace-title">
      <div className="score-trace-heading">
        <div><p className="step">表情量化</p><h2 id="score-trace-title">本次表情变化</h2></div>
        <p className="score-trace-reading" aria-live="polite">
          {active.timeSeconds.toFixed(1)} 秒 · 难绷程度 {active.score}
        </p>
      </div>
      <p className="hint">0 表示表情稳定，数值越高越接近绷不住。点击或聚焦数据点可读数。</p>
      <div className="score-trace-scroll" tabIndex={0} aria-label="表情变化折线图，可横向查看">
        <svg className="score-trace-chart" viewBox={`0 0 ${SCORE_CHART.width} ${SCORE_CHART.height}`} role="img" aria-labelledby="score-trace-svg-title score-trace-svg-desc">
          <title id="score-trace-svg-title">挑战过程中的难绷程度折线图</title>
          <desc id="score-trace-svg-desc">峰值 {peak.score}，出现在 {peak.timeSeconds.toFixed(1)} 秒；{markerLabel} {markerTime.toFixed(1)} 秒。</desc>
          {[0, 25, 50, 75, 100].map((value) => <g key={value}><line className="score-grid" x1={SCORE_CHART.left} x2={SCORE_CHART.width-SCORE_CHART.right} y1={scoreY(value)} y2={scoreY(value)}/><text className="score-axis-label" x={SCORE_CHART.left-9} y={scoreY(value)+4} textAnchor="end">{value}</text></g>)}
          <Threshold value={CLIENT_CONFIG.scoring.dangerThreshold} label="危险线" className="danger" />
          <Threshold value={CLIENT_CONFIG.scoring.failureThreshold} label="爆炸线" className="failure" />
          <line className="score-axis" x1={SCORE_CHART.left} x2={SCORE_CHART.width-SCORE_CHART.right} y1={SCORE_CHART.height-SCORE_CHART.bottom} y2={SCORE_CHART.height-SCORE_CHART.bottom}/>
          <text className="score-axis-label" x={SCORE_CHART.left} y={SCORE_CHART.height-12}>0 秒</text>
          <text className="score-axis-label" x={SCORE_CHART.width-SCORE_CHART.right} y={SCORE_CHART.height-12} textAnchor="end">{model.maxTime.toFixed(0)} 秒</text>
          {model.points.length > 1 && <polyline className="score-line" points={model.polyline} fill="none" />}
          {model.points.map((point, index) => (
            <g
              key={`${point.timeSeconds}-${index}`}
              className={`score-point-target${outcome === 'failed' && index === model.points.length-1 ? ' endpoint failed' : ''}`}
              tabIndex={0} role="button"
              aria-label={`${point.timeSeconds.toFixed(1)} 秒，难绷程度 ${point.score}${outcome === 'failed' && index === model.points.length-1 ? `，${markerLabel}` : ''}`}
              onFocus={() => setSelected(index)} onClick={() => setSelected(index)}
            >
              <circle className="score-point-hit" cx={point.x} cy={point.y} r={12}/>
              <circle className="score-point" cx={point.x} cy={point.y} r={index === model.points.length-1 ? 6 : 4}/>
            </g>
          ))}
          {outcome === 'held' && (
            <g className="score-end-marker" aria-label={`${durationSeconds.toFixed(1)} 秒，挑战终点`}>
              <line x1={scoreX(durationSeconds, model.maxTime)} x2={scoreX(durationSeconds, model.maxTime)} y1={SCORE_CHART.top} y2={SCORE_CHART.height-SCORE_CHART.bottom} />
              <text x={scoreX(durationSeconds, model.maxTime)-4} y={SCORE_CHART.top+13} textAnchor="end">挑战终点</text>
            </g>
          )}
        </svg>
      </div>
      <div className="score-trace-summary">
        <span><strong>{peak.score}</strong>峰值</span>
        <span><strong>{peak.timeSeconds.toFixed(1)}s</strong>峰值时刻</span>
        <span><strong>{model.dangerCount}</strong>个危险采样点</span>
        <span><strong>{markerTime.toFixed(1)}s</strong>{markerLabel}</span>
      </div>
    </section>
  );
}

function Threshold({ value, label, className }: { value: number; label: string; className: string }) {
  return <g className={`score-threshold ${className}`}><line x1={SCORE_CHART.left} x2={SCORE_CHART.width-SCORE_CHART.right} y1={scoreY(value)} y2={scoreY(value)}/><text x={SCORE_CHART.width-SCORE_CHART.right-4} y={scoreY(value)-5} textAnchor="end">{label} {value}</text></g>;
}
