import { useState } from 'react';
import { apiRequest, post } from '../api/client';
import { ScoreTraceChart } from './ScoreTraceChart';
import { Stats } from './Settlement';
import type { AggregateStats, ManageResult } from '../../shared/contracts';

const params=()=>new URLSearchParams(location.hash.slice(1));
export function ManageView(){const [token]=useState(()=>params().get('m')||'');const [result,setResult]=useState<ManageResult|null>(null);const [error,setError]=useState('');const load=async()=>{setError('');try{setResult(await post<ManageResult>('/api/manage/result',{},token));}catch(e){setError(e instanceof Error?e.message:'查询失败');}};const destroy=async()=>{if(!confirm('确定销毁私人结果吗？匿名统计贡献仍会保留。'))return;try{await apiRequest('/api/manage/result',{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});setResult({status:'deleted'});}catch(e){setError(e instanceof Error?e.message:'销毁失败');}};return <main className="page"><header className="hero compact"><p className="eyebrow">PRIVATE RESULT</p><h1>私密结果入口</h1><p className="intro">此页面不会自动轮询。管理凭证仅保存在地址栏片段中，不会随普通请求发送。</p></header><section className="section">{!token?<p className="error">管理链接不完整。</p>:<><button onClick={()=>void load()}>刷新状态</button>{result&&<ResultStatus result={result}/>} {result&&result.status!=='deleted'&&<button className="danger" onClick={()=>void destroy()}>销毁私人结果</button>}</>}{error&&<p className="error">{error}</p>}<p className="warning">销毁或到期会删除私人会话；已经完全脱敏的匿名次数和时间桶不会回退。</p></section></main>}
function ResultStatus({ result }: { result: ManageResult }) {
  const labels = { unopened: '尚未打开', opened: '已经打开', started: '挑战进行中', completed: '挑战已完成', deleted: '已销毁', expired: '已过期' };
  if (result.status !== 'completed') return <div className="manage-result"><h2>{labels[result.status]}</h2></div>;
  return <CompletedResult result={result} />;
}

function CompletedResult({ result }: { result: ManageResult }) {
  const outcome = result.outcome;
  const chartOutcome = outcome === 'held' || outcome === 'failed' ? outcome : null;
  const hasVideo = Boolean(result.video && Number.isFinite(result.video.duration) && result.video.duration > 0);
  const hasElapsed = typeof result.elapsedSeconds === 'number' && Number.isFinite(result.elapsedSeconds) && result.elapsedSeconds >= 0;
  const stats = isRenderableStats(result.stats) ? result.stats : null;
  return <>
    <section className={`settlement ${outcome === 'held' ? 'held' : 'failed'}`}>
      <p className="eyebrow">PRIVATE RESULT</p>
      <h1>{outcome === 'held' ? '你是真能绷' : outcome === 'failed' ? '炸了！' : '挑战已完成'}</h1>
      {result.video?.title && <h2>{result.video.title}</h2>}
      {hasElapsed ? <div className="time-score"><strong>{result.elapsedSeconds!.toFixed(1)}</strong><span>秒</span></div> : <p>结果秒数暂不可用。</p>}
      <p>{outcome === 'held' ? '完整看完，一次都没笑。' : outcome === 'failed' ? '这个瞬间击穿了你的防线。' : '结果记录完整，但结算状态缺少必要信息。'}</p>
    </section>
    {hasVideo && chartOutcome ? <ScoreTraceChart points={result.scoreTrace ?? []} outcome={chartOutcome} durationSeconds={result.video!.duration} /> : (
      <section className="section score-trace-section"><h2>本次表情变化</h2><p className="muted score-trace-empty">这条私密结果缺少可用的视频或曲线数据，无法绘制变化曲线。</p></section>
    )}
    {stats ? <Stats stats={stats} /> : <section className="section"><h2>匿名战况</h2><p className="muted">匿名统计暂不可用。</p></section>}
    {typeof result.expiresAt === 'number' && Number.isFinite(result.expiresAt) && result.expiresAt > 0 && <p className="hint private-result-expiry">私密详情将保留至 {new Date(result.expiresAt * 1000).toLocaleString()}，到期后曲线和本次结果会一起删除。</p>}
  </>;
}

function isRenderableStats(value: AggregateStats | undefined): value is AggregateStats {
  if (!value || !Number.isFinite(value.total) || !Number.isFinite(value.held) || !Number.isFinite(value.failed) || !Number.isFinite(value.failureRate) || !Number.isFinite(value.averageElapsedSeconds) || !Array.isArray(value.buckets)) return false;
  if (![value.total, value.held, value.failed].every((item) => Number.isInteger(item) && item >= 0)) return false;
  if (value.held + value.failed > value.total || value.failureRate < 0 || value.failureRate > 1 || value.averageElapsedSeconds < 0) return false;
  return value.buckets.every((bucket) => Number.isFinite(bucket.startSeconds) && bucket.startSeconds >= 0 && Number.isInteger(bucket.count) && bucket.count >= 0);
}
