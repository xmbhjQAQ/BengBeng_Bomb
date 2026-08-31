import { useCallback, useEffect, useState } from 'react';
import { HomeView } from './HomeView';
import { ChallengeView } from './ChallengeView';
import { ManageView } from './ManageView';
import { ReportView } from './ReportView';
import { GroupResultsView } from './GroupResultsView';
import { GroupEntryView } from './GroupEntryView';
import { SiteFooter } from './SiteFooter';

export function App(){const [path,setPath]=useState(location.pathname);useEffect(()=>{const sync=()=>setPath(location.pathname);addEventListener('popstate',sync);return()=>removeEventListener('popstate',sync);},[]);const navigate=useCallback((next:string)=>{history.pushState({},'',next);setPath(next);},[]);const challenge=path.match(/^\/c\/([^/]+)$/);const groupEntry=path.match(/^\/g\/entry\/([^/]+)$/);const groupResults=path.match(/^\/g\/results\/([^/]+)$/);const group=path.match(/^\/g\/([^/]+)$/);const report=path.match(/^\/report\/([^/]+)$/);const view=challenge?<ChallengeView token={decodeURIComponent(challenge[1]!)}/>:groupEntry?<GroupEntryView token={decodeURIComponent(groupEntry[1]!)} navigate={navigate}/>:groupResults?<GroupResultsView token={decodeURIComponent(groupResults[1]!)}/>:group?<ChallengeView token={decodeURIComponent(group[1]!)} group/>:report?<ReportView token={decodeURIComponent(report[1]!)}/>:path==='/manage'?<ManageView/>:<HomeView navigate={navigate}/>;return <><div className="app-view">{view}</div><SiteFooter/></>;}
