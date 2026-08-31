import { useState } from 'react';
import { apiRequest, post } from '../api/client';
import { ScoreTraceChart } from './ScoreTraceChart';
import { Stats } from './Settlement';
import { normalizeGroupManage } from './groupTypes';
import type { AggregateStats, GroupManageResult, ManageResult } from '../../shared/contracts';

const params=()=>new URLSearchParams(location.hash.slice(1));
export function ManageView(){const [token]=useState(()=>params().get('m')||'');const isGroup=token.startsWith('bgm1.');const [result,setResult]=useState<ManageResult|null>(null);const [groupResult,setGroupResult]=useState<GroupManageResult|null>(null);const [error,setError]=useState('');const [groupDeleted,setGroupDeleted]=useState(false);const load=async()=>{setError('');try{if(isGroup){setGroupDeleted(false);setResult(null);setGroupResult(normalizeGroupManage(await post<unknown>('/api/groups/manage',{},token)));}else{setGroupResult(null);setResult(await post<ManageResult>('/api/manage/result',{},token));}}catch(e){setError(e instanceof Error?e.message:'查询失败');}};const end=async()=>{if(!isGroup||!confirm('确定结束这个群组挑战吗？结束后不能再加入，已经完成的结果仍会保留。'))return;setError('');try{setGroupResult(normalizeGroupManage(await post<unknown>('/api/groups/manage?action=end',{},token)));}catch(e){setError(e instanceof Error?e.message:'结束失败');}};const destroy=async()=>{if(!confirm(isGroup?'确定删除这个群组挑战吗？删除后无法恢复，公开视频统计仍会保留。':'确定删除这次私密结果吗？删除后无法恢复，公开统计仍会保留。'))return;try{if(isGroup){await apiRequest('/api/groups/manage',{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});setGroupDeleted(true);setGroupResult(null);}else{await apiRequest('/api/manage/result',{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});setResult({status:'deleted'});}}catch(e){setError(e instanceof Error?e.message:'删除失败');}};return <main className="page"><header className="hero compact"><p className="eyebrow">{isGroup?'群组管理':'私密结果'}</p><h1>{isGroup?'群组挑战管理':'私密结果入口'}</h1><p className="intro">{isGroup?'查看群组进度，或结束/删除这组挑战。管理入口只保存在你的链接中，请勿转发。':'这是本次挑战的私密结果页。点击“刷新状态”查看最新结果，请勿把此页分享给其他人。'}</p></header><section className="section">{!token?<p className="error">结果入口不完整，请使用发起挑战时保存的链接。</p>:<><button type="button" onClick={()=>void load()}>刷新状态</button>{isGroup?groupDeleted?<div className="manage-result"><h2>尚未打开或已销毁</h2></div>:groupResult&&<GroupManageStatus result={groupResult}/>:result&&<ResultStatus result={result}/>} {isGroup&&groupResult?.status==='active'&&<button type="button" className="secondary" onClick={()=>void end()}>结束群组挑战</button>} {isGroup?(groupResult&&groupResult.status!=='expired'&&!groupDeleted&&<button type="button" className="danger" onClick={()=>void destroy()}>删除群组挑战</button>):(result&&result.status!=='deleted'&&result.status!=='expired'&&<button type="button" className="danger" onClick={()=>void destroy()}>删除私密结果</button>)}</>}{error&&<p className="error">{error}</p>}<p className="warning">{isGroup?'群组到期或被删除后将无法继续参与；已经计入视频统计的匿名数据仍会保留。':'结果到期或被删除后将无法恢复；公开统计仍会保留。'}</p></section></main>}

function GroupManageStatus({ result }: { result: GroupManageResult }) {
  const labels = { unopened: '尚未打开或已销毁', active: '群组挑战进行中', ended: '群组挑战已结束', expired: '群组挑战已到期' };
  return <div className="manage-result"><h2>{labels[result.status]}</h2><div className="stats-grid"><div><strong>{result.summary.total}</strong><span>已完成</span></div><div><strong>{result.summary.held}</strong><span>绷住</span></div><div><strong>{result.summary.failed}</strong><span>没绷住</span></div></div></div>;
}
function ResultStatus({ result }: { result: ManageResult }) {
  const labels = { unopened: '尚未打开或已销毁', opened: '等待挑战开始', started: '挑战进行中', completed: '挑战已完成', deleted: '尚未打开或已销毁', expired: '结果已过期' };
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
      <p className="eyebrow">私密结果</p>
      <h1>{outcome === 'held' ? '你是真能绷' : outcome === 'failed' ? '炸了！' : '挑战已完成'}</h1>
      {result.video?.title && <h2>{result.video.title}</h2>}
      {hasElapsed ? <div className="time-score"><strong>{result.elapsedSeconds!.toFixed(1)}</strong><span>秒</span></div> : <p>结果秒数暂不可用。</p>}
      <p>{outcome === 'held' ? '全程绷住，挑战成功。' : outcome === 'failed' ? '这个瞬间击穿了你的防线。' : '结果记录完整，但结算状态缺少必要信息。'}</p>
    </section>
    {hasVideo && chartOutcome ? <ScoreTraceChart points={result.scoreTrace ?? []} outcome={chartOutcome} durationSeconds={result.video!.duration} /> : (
      <section className="section score-trace-section"><h2>本次表情变化</h2><p className="muted score-trace-empty">这条结果的详细变化暂时不可用，但坚持时间仍可查看。</p></section>
    )}
    {stats ? <Stats stats={stats} /> : <section className="section"><h2>大家的挑战情况</h2><p className="muted">大家的挑战情况暂时无法加载。</p></section>}
    {typeof result.expiresAt === 'number' && Number.isFinite(result.expiresAt) && result.expiresAt > 0 && <p className="hint private-result-expiry">这份私密结果会保留一段时间，之后将无法查看。</p>}
  </>;
}

function isRenderableStats(value: AggregateStats | undefined): value is AggregateStats {
  if (!value || !Number.isFinite(value.total) || !Number.isFinite(value.held) || !Number.isFinite(value.failed) || !Number.isFinite(value.failureRate) || !Number.isFinite(value.averageElapsedSeconds) || !Array.isArray(value.buckets)) return false;
  if (![value.total, value.held, value.failed].every((item) => Number.isInteger(item) && item >= 0)) return false;
  if (value.held + value.failed > value.total || value.failureRate < 0 || value.failureRate > 1 || value.averageElapsedSeconds < 0) return false;
  return value.buckets.every((bucket) => Number.isFinite(bucket.startSeconds) && bucket.startSeconds >= 0 && Number.isInteger(bucket.count) && bucket.count >= 0);
}
