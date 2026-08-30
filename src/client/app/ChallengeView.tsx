import { useEffect, useRef, useState } from 'react';
import { post } from '../api/client';
import type { AggregateStats, ChallengePayload, PlaybackData } from '../../shared/contracts';
import { useSmileDemo } from '../gameplay/app/useSmileDemo';
import { CameraPanel } from '../gameplay/app/CameraPanel';
import { ChallengePanel } from '../gameplay/app/ChallengePanel';
import { invalidReasonText } from '../gameplay/app/viewText';
import { Settlement } from './Settlement';

interface Opened {challenge:ChallengePayload;playback:PlaybackData;stats:AggregateStats;session:{state:'opened'|'started'|'completed'}|null}
interface Completed {outcome:'held'|'failed';elapsedSeconds:number;reportUrl:string;stats:AggregateStats}
const attemptKey=(token:string)=>`bengbeng-attempt:${token}`;
const activePhases=['running','face-grace','face-paused','resume-stabilizing','resume-countdown','buffering'];
export function ChallengeView({token}:{token:string}){const demo=useSmileDemo();const [opened,setOpened]=useState<Opened|null>(null);const [attempt,setAttempt]=useState(()=>sessionStorage.getItem(attemptKey(token))||'');const [completed,setCompleted]=useState<Completed|null>(null);const [error,setError]=useState('');const [accepted,setAccepted]=useState(false);const loaded=useRef(false);const submitted=useRef(false);const active=activePhases.includes(demo.phase);
  useEffect(()=>{if(loaded.current)return;loaded.current=true;void post<Opened>('/api/challenges/open',{challengeToken:token}).then(value=>{setOpened(value);demo.selectResolvedBilibili(value.playback);}).catch(e=>setError(e instanceof Error?e.message:'挑战加载失败'));},[token,demo]);
  useEffect(()=>{if(!demo.result||!attempt||submitted.current)return;submitted.current=true;const outcome=demo.result.outcome==='completed'?'held':'failed';void post<Completed>('/api/challenges/complete',{challengeToken:token,attemptToken:attempt,outcome,elapsedSeconds:demo.result.videoPositionSeconds}).then(value=>{sessionStorage.removeItem(attemptKey(token));setCompleted(value);void document.exitFullscreen?.().catch(()=>undefined);}).catch(e=>{submitted.current=false;setError(e instanceof Error?e.message:'结果提交失败');});},[attempt,demo.result,token]);
  const start=async()=>{try{let currentAttempt=attempt;if(!currentAttempt){const value=await post<{attemptToken:string}>('/api/challenges/start',{challengeToken:token});currentAttempt=value.attemptToken;sessionStorage.setItem(attemptKey(token),currentAttempt);setAttempt(currentAttempt);}try{await document.documentElement.requestFullscreen?.();}catch{/* iOS and embedded browsers use the immersive page fallback. */}demo.startChallenge();}catch(e){setError(e instanceof Error?e.message:'开始失败');}};
  if(error&&!opened)return <Message title="挑战无法打开" detail={error}/>;if(!opened)return <Message title="正在拆弹…" detail="正在验证挑战并刷新视频直链"/>;if(completed)return <Settlement challenge={opened.challenge} result={completed}/>;
  if(opened.session?.state==='completed')return <Message title="这枚炸弹已经引爆过了" detail="每个挑战只记录一次结果，请让发起者查看私密结果入口。"/>;
  if(opened.session?.state==='started'&&!attempt)return <Message title="挑战已经开始" detail="一次性挑战不能由另一个会话重新接管。"/>;
  return <main className={`page challenge-page${active?' is-active':''}`}><header className="hero compact"><p className="eyebrow">{opened.challenge.recipient?`${opened.challenge.recipient}，接招吧`:'一枚绷绷炸弹'}</p><h1>{opened.challenge.initiator} 挑战你</h1><p className="intro">{opened.challenge.message||'看完整段视频，全程不许笑。'}</p></header>
    {!accepted?<section className="section consent"><VideoIntro video={opened.challenge.video}/><h2>开始前，请确认隐私说明</h2><ul><li>摄像头画面和人脸特征只在你的浏览器中检测，不上传、不保存。</li><li>只会提交最终成功/失败和坚持秒数，发起者可以查看。</li><li>脱敏后的结果会计入这条视频的匿名统计，销毁私人结果后仍会保留。</li></ul><button onClick={()=>{setAccepted(true);demo.openCamera();}}>我知道了，接受挑战</button></section>:<>
      <CameraPanel bubble={active} cameraStatus={demo.cameraStatus} detectorStatus={demo.detectorStatus} calibrationIssue={demo.calibrationIssue} calibrationProgress={demo.calibrationProgress} calibrating={demo.phase==='calibrating'} profile={demo.profile} canCalibrate={demo.canCalibrate} onOpen={demo.openCamera} onRetryDetector={demo.retryDetector} onCalibrate={demo.startCalibration} setCameraElement={demo.setCameraElement}/>
      <ChallengePanel hasVideo={Boolean(demo.bilibiliSelection)} dimension={demo.bilibiliSelection?.dimension} phase={demo.phase} canStart={demo.canStart} sample={demo.sample} countdownSeconds={demo.countdownSeconds} playerError={demo.playerError} danmakuStatus={demo.danmakuStatus} setPlayerContainer={demo.setPlayerContainer} onStart={()=>void start()}/>
      {demo.phase==='invalid'&&<section className="section invalid-panel"><h2>本轮已作废</h2><p>{invalidReasonText(demo.invalidReason)}</p><button onClick={demo.restart}>重新准备</button></section>}
      {error&&<p className="error" role="alert">{error}</p>}
    </>}</main>;
}
function VideoIntro({video}:{video:ChallengePayload['video']}){return <div className="video-meta challenge-intro-video"><div className="video-cover">{video.cover?<img referrerPolicy="no-referrer" src={video.cover} alt="视频封面"/>:<span>无封面</span>}</div><div><p className="video-title">{video.title}</p><p className="video-subtitle">{Math.round(video.duration)} 秒 · {video.bvid}</p>{video.description&&<p className="muted clamp">{video.description}</p>}</div></div>}
function Message({title,detail}:{title:string;detail:string}){return <main className="page"><section className="section"><h1>{title}</h1><p>{detail}</p><a href="/">返回首页</a></section></main>}
