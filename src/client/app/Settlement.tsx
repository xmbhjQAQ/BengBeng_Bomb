import { downloadBlob } from '../sharing/card';
import { createSettlementCard } from '../sharing/settlementCard';
import type { AggregateStats, ScorePoint } from '../../shared/contracts';
import { createHeatmapBars } from './heatmap';
import { ScoreTraceChart } from './ScoreTraceChart';
import { CopyButton } from './CopyButton';
import { compactLink } from './linkDisplay';
import { PublicQrCode } from './PublicQrCode';
import { GroupParticipantList } from './GroupParticipantList';
import type { ChallengeDisplayPayload, GroupParticipant } from './groupTypes';
import { useState } from 'react';
import { writeSession } from '../storage/session';

interface SettlementResult {
  outcome: 'held' | 'failed';
  elapsedSeconds: number;
  reportUrl?: string;
  stats: AggregateStats;
  scoreTrace?: readonly ScorePoint[];
  resultUrl?: string;
  groupParticipants?: readonly GroupParticipant[];
  groupNextCursor?: string | null;
  groupTotal?: number;
}

export function Settlement({
  challenge,
  result,
  embedded = false,
}: {
  challenge: ChallengeDisplayPayload;
  result: SettlementResult;
  embedded?: boolean;
}) {
  const held = result.outcome === 'held';
  const isGroup = Boolean(result.resultUrl || result.groupParticipants || typeof result.groupTotal === 'number');
  const publicUrl = result.resultUrl || result.reportUrl || '';
  const [shareState, setShareState] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');
  const [shareError, setShareError] = useState('');
  const share = async () => {
    if (shareState === 'generating') return;
    setShareState('generating');
    setShareError('');
    try {
      if (!publicUrl) throw new Error('公开结算链接暂时不可用');
      const blob = await createSettlementCard({
        publicUrl,
        video: challenge.video,
        outcome: result.outcome,
        elapsedSeconds: result.elapsedSeconds,
        scoreTrace: result.scoreTrace ?? [],
        stats: result.stats,
        ...(isGroup ? { isGroup: true, groupTotal: result.groupTotal ?? result.groupParticipants?.length ?? 0 } : {}),
      });
      downloadBlob(blob, '绷绷炸弹-结算.png');
      setShareState('success');
    } catch (error) {
      setShareState('error');
      setShareError(error instanceof Error ? error.message : '结算长图生成失败，请重试');
    }
  };
  const forward = () => {
    writeSession('forward-video', `https://www.bilibili.com/video/${challenge.video.bvid}`);
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
        <p>{held ? '全程绷住，挑战成功。' : '这个瞬间击穿了你的防线。'}</p>
      </section>
      <ScoreTraceChart points={result.scoreTrace ?? []} outcome={result.outcome} durationSeconds={challenge.video.duration} />
      <Stats stats={result.stats} />
      {isGroup && <section className="section group-settlement-results">
        <div className="group-results-heading"><div><p className="step">群组进度</p><h2>大家的结果</h2></div><span className="group-results-total">已完成 {result.groupTotal ?? result.groupParticipants?.length ?? 0} 人</span></div>
        <GroupParticipantList participants={result.groupParticipants ?? []} />
        {result.resultUrl && <div className="group-result-access"><div><p className="muted">把结果页发回群里，随时查看最新完成记录。</p><div className="link-box"><strong>群组结果链接</strong><code aria-label="群组结果链接已缩略，可点击复制完整链接">{compactLink(result.resultUrl)}</code><CopyButton value={result.resultUrl} label="复制结果链接" /></div></div><PublicQrCode url={result.resultUrl} label="扫码查看结果" /></div>}
        {result.groupNextCursor && <p className="hint">还有更多结果，可打开结果链接继续查看。</p>}
      </section>}
      <section className="section">
        <h2>分享结果</h2>
        <div className="button-row">
          <button type="button" onClick={() => void share()} disabled={shareState === 'generating'} aria-busy={shareState === 'generating'}>
            {shareState === 'generating' ? '正在生成结算长图…' : shareState === 'success' ? '已下载结算长图' : shareState === 'error' ? '重新生成结算长图' : '下载结算长图'}
          </button>
          {publicUrl && <CopyButton value={publicUrl} label={isGroup ? '复制结果链接' : '复制公开战报链接'} />}
          <a
            className="button-link"
            href="/"
            onClick={(event) => { event.preventDefault(); forward(); }}
          >转发此挑战</a>
        </div>
        {shareState === 'success' && <p className="share-feedback" role="status">结算长图已下载，图中包含扫码查看结算页面的二维码。</p>}
        {shareState === 'error' && <p className="error share-feedback" role="alert">{shareError || '结算长图生成失败，请重试。'}</p>}
      </section>
    </>
  );
  return embedded ? content : <main className="page">{content}</main>;
}

export function Stats({ stats }: { stats: AggregateStats }) {
  const bars = createHeatmapBars(stats.buckets);
  const emptyHeatmapText = stats.total === 0
    ? '还没有完成记录，来做第一位挑战者。'
    : stats.failed === 0
      ? `已有 ${stats.total} 次挑战全部绷住，暂无失败时间分布。`
      : '已有失败记录，但暂时没有可显示的失败时间分布。';
  return (
    <section className="section">
      <h2>大家的挑战情况</h2>
      <div className="stats-grid">
        <div><strong>{stats.total}</strong><span>挑战次数</span></div>
        <div><strong>{stats.held}</strong><span>绷住人数</span></div>
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
      ) : <p className="muted heatmap-empty">{emptyHeatmapText}</p>}
    </section>
  );
}
