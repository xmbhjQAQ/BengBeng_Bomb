import { useCallback, useEffect, useState } from 'react';
import { HomeView } from './HomeView';
import { ChallengeView } from './ChallengeView';
import { ManageView } from './ManageView';
import { ReportView } from './ReportView';

export function App(){const [path,setPath]=useState(location.pathname);useEffect(()=>{const sync=()=>setPath(location.pathname);addEventListener('popstate',sync);return()=>removeEventListener('popstate',sync);},[]);const navigate=useCallback((next:string)=>{history.pushState({},'',next);setPath(next);},[]);const challenge=path.match(/^\/c\/(.+)$/);if(challenge)return <ChallengeView token={decodeURIComponent(challenge[1]!)}/>;const report=path.match(/^\/report\/(.+)$/);if(report)return <ReportView token={decodeURIComponent(report[1]!)}/>;if(path==='/manage')return <ManageView/>;return <HomeView navigate={navigate}/>;}
