import { createShareCard, downloadBlob } from '../sharing/card';
import type { AggregateStats, ChallengePayload, ScorePoint } from '../../shared/contracts';
import { createHeatmapBars } from './heatmap';
import { ScoreTraceChart } from './ScoreTraceChart';
import { CopyButton } from './CopyButton';

interface SettlementResult {
  outcome: 'held' | 'failed';
  elapsedSeconds: number;
  reportUrl: string;
  stats: AggregateStats;
  scoreTrace?: readonly ScorePoint[];
}

export function Settlement({
  challenge,
  result,
  embedded = false,
}: {
  challenge: ChallengePayload;
  result: SettlementResult;
  embedded?: boolean;
}) {
  const held = result.outcome === 'held';
  const share = async () => downloadBlob(await createShareCard({
    url: result.reportUrl,
    video: challenge.video,
    heading: held ? '成功绷住！' : '绷不住了！',
    lines: [held ? '整段视频都没有笑' : '坚持到了这一秒', `${result.elapsedSeconds.toFixed(1)} 秒`],
    stats: result.stats,
  }), '绷绷炸弹-战报.png');
  const forward = () => {
    sessionStorage.setItem('forward-video', `https://www.bilibili.com/video/${challenge.video.bvid}`);
    if (window.location.pathname === '/') return;
    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  const content = (
    <>
      <section className={`settlement ${held ? 'held' : 'failed'}`}>
        <p className="eyebrow">挑战完成</p>
        <h1>{held ? '你是真能绷' : '炸了！'}</h1>
        <div className="time-score"><strong>{result.elapsedSeconds.toFixed(1)}</strong><span>秒</span></div>
        <p>{held ? '完整看完，一次都没笑。' : '这个瞬间击穿了你的防线。'}</p>
      </section>
      <ScoreTraceChart points={result.scoreTrace ?? []} outcome={result.outcome} durationSeconds={challenge.video.duration} />
      <Stats stats={result.stats} />
      <section className="section">
        <h2>分享结果</h2>
        <div className="button-row">
          <button type="button" onClick={() => void share()}>下载结果图</button>
          <CopyButton value={result.reportUrl} label="复制公开战报链接" />
          <a
            className="button-link"
            href="/"
            onClick={(event) => { event.preventDefault(); forward(); }}
          >转发此挑战</a>
        </div>
      </section>
    </>
  );
  return embedded ? content : <main className="page">{content}</main>;
}

export function Stats({ stats }: { stats: AggregateStats }) {
  const bars = createHeatmapBars(stats.buckets);
  return (
    <section className="section">
      <h2>大家的挑战情况</h2>
      <div className="stats-grid">
        <div><strong>{stats.total}</strong><span>挑战次数</span></div>
        <div><strong>{stats.held}</strong><span>完整看完</span></div>
        <div><strong>{(stats.failureRate * 100).toFixed(0)}%</strong><span>没绷住比例</span></div>
        <div><strong>{stats.averageElapsedSeconds.toFixed(1)}s</strong><span>平均坚持时间</span></div>
      </div>
      {bars.length ? (
        <div className="heatmap-scroll" tabIndex={0} aria-label="没绷住的时间分布，可左右滑动查看">
          <div className="heatmap" role="list">
            {bars.map((bar) => (
              <div className="heatmap-column" role="listitem" aria-label={bar.accessibleLabel} key={bar.startSeconds}>
                <strong className="heatmap-count">{bar.count} 人</strong>
                <div className="heatmap-plot">
                  <span className="heatmap-bar" style={{ height: `${bar.heightPercent}%` }} aria-hidden="true" />
                </div>
                <span className="heatmap-label">{bar.rangeLabel}</span>
              </div>
            ))}
          </div>
        </div>
      ) : <p className="muted heatmap-empty">还没有人记录没绷住的时间，你是第一批挑战者。</p>}
    </section>
  );
}
