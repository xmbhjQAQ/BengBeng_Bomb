import { useEffect, useState } from 'react';
import type { LeaderboardEntry } from '../../shared/contracts';
import { apiRequest, post } from '../api/client';
import { ComposerView, type ParsedVideo } from './ComposerView';
import { MyChallengesView } from './MyChallengesView';
import { upsertCreatedChallenge } from '../storage/createdChallenges';

const HOME_TABS = ['compose', 'history', 'leaderboard'] as const;
type HomeTab = typeof HOME_TABS[number];
interface CreatedChallenge { challengeUrl: string; manageUrl: string; expiresAt: number }

export function HomeView({ navigate }: { navigate(path: string): void }) {
  const [tab, setTab] = useState<HomeTab>('compose');
  const [prefill, setPrefill] = useState<ParsedVideo | null>(null);
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyBvid, setBusyBvid] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try { setEntries((await apiRequest<{ entries: LeaderboardEntry[] }>('/api/leaderboard')).entries); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '排行榜加载失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (tab === 'leaderboard' && entries === null && !error && !loading) void load(); }, [entries, error, loading, tab]);

  const resolve = async (entry: LeaderboardEntry) => post<ParsedVideo>('/api/bilibili/parse', { input: entry.video.bvid });
  const share = async (entry: LeaderboardEntry) => {
    setBusyBvid(entry.video.bvid); setError('');
    try { setPrefill(await resolve(entry)); setTab('compose'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '视频解析失败，请稍后重试'); }
    finally { setBusyBvid(''); }
  };
  const challenge = async (entry: LeaderboardEntry) => {
    setBusyBvid(entry.video.bvid); setError('');
    try {
      const parsed = await resolve(entry);
      const created = await post<CreatedChallenge>('/api/challenges', { videoTicket: parsed.videoTicket, mode: 'self' });
      upsertCreatedChallenge({
        kind: 'self',
        video: parsed.video,
        createdAt: Math.floor(Date.now() / 1000),
        expiresAt: created.expiresAt,
        challengeUrl: created.challengeUrl,
        manageUrl: created.manageUrl,
      });
      const path = new URL(created.challengeUrl, location.origin).pathname;
      navigate(path);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '单人挑战创建失败，请稍后重试'); }
    finally { setBusyBvid(''); }
  };

  return <main className="page home-page">
    <header className="hero home-hero"><p className="eyebrow">BENG BENG BOMB</p><h1>绷绷炸弹</h1><p className="intro">挑一段 B 站视频，看看朋友能绷到第几秒。</p>
      <div className="home-tabs" role="tablist" aria-label="首页功能" onKeyDown={(event)=>{if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();const current=HOME_TABS.indexOf(tab);const offset=event.key==='ArrowRight'?1:-1;const next=HOME_TABS[(current+offset+HOME_TABS.length)%HOME_TABS.length]!;setTab(next);event.currentTarget.querySelector<HTMLButtonElement>(`#tab-${next}`)?.focus();}}>
        <button role="tab" id="tab-compose" tabIndex={tab==='compose'?0:-1} aria-selected={tab==='compose'} aria-controls="panel-compose" className={tab==='compose'?'active':''} onClick={()=>setTab('compose')}>制作挑战</button>
        <button role="tab" id="tab-history" tabIndex={tab==='history'?0:-1} aria-selected={tab==='history'} aria-controls="panel-history" className={tab==='history'?'active':''} onClick={()=>setTab('history')}>我的挑战</button>
        <button role="tab" id="tab-leaderboard" tabIndex={tab==='leaderboard'?0:-1} aria-selected={tab==='leaderboard'} aria-controls="panel-leaderboard" className={tab==='leaderboard'?'active':''} onClick={()=>setTab('leaderboard')}>难绷排行</button>
      </div>
    </header>
    <section id="panel-compose" role="tabpanel" aria-labelledby="tab-compose" hidden={tab!=='compose'} className="home-panel"><ComposerView embedded prefill={prefill}/></section>
    <section id="panel-history" role="tabpanel" aria-labelledby="tab-history" hidden={tab!=='history'} className="home-panel my-challenges-panel"><MyChallengesView navigate={navigate}/></section>
    <section id="panel-leaderboard" role="tabpanel" aria-labelledby="tab-leaderboard" hidden={tab!=='leaderboard'} className="home-panel leaderboard-panel">
      <div className="leaderboard-heading"><div><p className="step">永久累计 · 大家记录</p><h2>难绷排行榜</h2></div><p>综合大家的坚持时间和没绷住的比例，看看哪些视频最容易让人破防。</p></div>
      {entries===null&&!error&&<p className="leaderboard-state" role="status">正在加载难绷排行…</p>}
      {error&&<div className="leaderboard-state" role="alert"><p>{error}</p><button type="button" className="secondary" onClick={()=>void load()}>重新加载</button></div>}
      {entries?.length===0&&<p className="leaderboard-state">还没有足够的挑战记录，来完成第一批挑战吧。</p>}
      {entries&&entries.length>0&&<ol className="leaderboard-list">{entries.map((entry)=><li key={`${entry.video.bvid}-${entry.video.page}`} className={entry.rank<=3?`leaderboard-card top-${entry.rank}`:'leaderboard-card'}>
        <div className="leaderboard-rank" aria-label={`第 ${entry.rank} 名`}>{entry.rank<=3?['🥇','🥈','🥉'][entry.rank-1]:`#${entry.rank}`}</div>
        <div className="leaderboard-cover">{entry.video.cover?<img src={entry.video.cover} referrerPolicy="no-referrer" alt=""/>:<span>无封面</span>}</div>
        <div className="leaderboard-info"><h3>{entry.video.title}</h3><p>{entry.total} 次挑战 · 爆炸率 {(entry.failureRate*100).toFixed(0)}% · 难绷指数 <strong>{entry.difficultyScore.toFixed(1)}</strong></p></div>
        <div className="leaderboard-actions"><button type="button" disabled={Boolean(busyBvid)} onClick={()=>void challenge(entry)}>{busyBvid===entry.video.bvid?'处理中…':'我来挑战'}</button><button type="button" className="secondary" disabled={Boolean(busyBvid)} onClick={()=>void share(entry)}>分享给朋友</button></div>
      </li>)}</ol>}
    </section>
  </main>;
}
