import { useCallback, useEffect, useState } from 'react';
import { HomeView } from './HomeView';
import { ChallengeView } from './ChallengeView';
import { ManageView } from './ManageView';
import { ReportView } from './ReportView';
import { GroupResultsView } from './GroupResultsView';
import { GroupEntryView } from './GroupEntryView';
import { SiteFooter } from './SiteFooter';

function decodeRouteSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded && decoded.length <= 16_384 ? decoded : null;
  } catch {
    return null;
  }
}

function InvalidRoute() {
  return <main className="page"><section className="section"><h1>链接无法打开</h1><p>这条链接格式不正确，请重新打开或让发起者重新生成。</p><a href="/">返回首页</a></section></main>;
}

export function App(){const [path,setPath]=useState(location.pathname);useEffect(()=>{const sync=()=>setPath(location.pathname);addEventListener('popstate',sync);return()=>removeEventListener('popstate',sync);},[]);const navigate=useCallback((next:string)=>{history.pushState({},'',next);setPath(next);},[]);const challenge=path.match(/^\/c\/([^/]+)$/);const groupEntry=path.match(/^\/g\/entry\/([^/]+)$/);const groupResults=path.match(/^\/g\/results\/([^/]+)$/);const group=path.match(/^\/g\/([^/]+)$/);const report=path.match(/^\/report\/([^/]+)$/);const challengeToken=challenge&&decodeRouteSegment(challenge[1]!);const groupEntryToken=groupEntry&&decodeRouteSegment(groupEntry[1]!);const groupResultsToken=groupResults&&decodeRouteSegment(groupResults[1]!);const groupToken=group&&decodeRouteSegment(group[1]!);const reportToken=report&&decodeRouteSegment(report[1]!);const view=(challenge&&!challengeToken)||(groupEntry&&!groupEntryToken)||(groupResults&&!groupResultsToken)||(group&&!groupToken)||(report&&!reportToken)?<InvalidRoute/>:challenge?<ChallengeView token={challengeToken!}/>:groupEntry?<GroupEntryView token={groupEntryToken!} navigate={navigate}/>:groupResults?<GroupResultsView token={groupResultsToken!}/>:group?<ChallengeView token={groupToken!} group/>:report?<ReportView token={reportToken!}/>:path==='/manage'?<ManageView/>:<HomeView navigate={navigate}/>;return <><div className="app-view">{view}</div><SiteFooter/></>;}
