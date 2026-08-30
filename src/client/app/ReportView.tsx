import { useEffect, useState } from 'react';
import { post } from '../api/client';
import type { AggregateStats, ReportPayload } from '../../shared/contracts';
import { Stats } from './Settlement';

export function ReportView({token}:{token:string}){const [data,setData]=useState<{report:ReportPayload;stats:AggregateStats}|null>(null);const [error,setError]=useState('');useEffect(()=>{void post<{report:ReportPayload;stats:AggregateStats}>('/api/reports/resolve',{reportToken:token}).then(setData).catch(e=>setError(e instanceof Error?e.message:'报告加载失败'));},[token]);if(error)return <main className="page"><section className="section"><h1>报告不可用</h1><p>{error}</p></section></main>;if(!data)return <main className="page"><p>正在加载战报…</p></main>;return <main className="page"><section className={`settlement ${data.report.outcome==='held'?'held':'failed'}`}><p className="eyebrow">PUBLIC REPORT</p><h1>{data.report.outcome==='held'?'成功绷住':'没绷住'}</h1><h2>{data.report.video.title}</h2><div className="time-score"><strong>{data.report.elapsedSeconds.toFixed(1)}</strong><span>秒</span></div></section><Stats stats={data.stats}/><a className="button-link" href={`/`}>我也要制作挑战</a></main>}
