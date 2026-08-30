import { ComposerView } from './ComposerView';
import { ChallengeView } from './ChallengeView';
import { ManageView } from './ManageView';
import { ReportView } from './ReportView';

export function App(){const path=location.pathname;const challenge=path.match(/^\/c\/(.+)$/);if(challenge)return <ChallengeView token={decodeURIComponent(challenge[1]!)}/>;const report=path.match(/^\/report\/(.+)$/);if(report)return <ReportView token={decodeURIComponent(report[1]!)}/>;if(path==='/manage')return <ManageView/>;return <ComposerView/>;}
