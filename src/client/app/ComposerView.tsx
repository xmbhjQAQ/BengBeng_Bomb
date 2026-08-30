import { useCallback, useEffect, useRef, useState } from 'react';
import { post } from '../api/client';
import { createShareCard, downloadBlob } from '../sharing/card';
import { CLIENT_CONFIG } from '../../shared/config/client';
import type { PlaybackData, VideoMetadata } from '../../shared/contracts';
import { CopyButton } from './CopyButton';
import { compactLink } from './linkDisplay';

export interface ParsedVideo { video: PlaybackData; videoTicket: string }
interface Created { challengeUrl:string;manageUrl:string;expiresAt:number }
export function ComposerView({ embedded = false, prefill }: { embedded?: boolean; prefill?: ParsedVideo | null }){
  const [input,setInput]=useState(sessionStorage.getItem('forward-video')||'');const [parsed,setParsed]=useState<ParsedVideo|null>(prefill??null);const [created,setCreated]=useState<Created|null>(null);const [initiator,setInitiator]=useState('');const [recipient,setRecipient]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const autoForwardStarted = useRef(false);
  useEffect(()=>{if(!prefill)return;setParsed(prefill);setInput(`https://www.bilibili.com/video/${prefill.video.bvid}`);setCreated(null);setError('');},[prefill]);
  const parse=useCallback(async(value = input, clearForward = false)=>{setBusy(true);setError('');try{setParsed(await post<ParsedVideo>('/api/bilibili/parse',{input:value}));setCreated(null);if(clearForward||value===input)sessionStorage.removeItem('forward-video');}catch(e){setError(e instanceof Error?e.message:'解析失败');}finally{setBusy(false);}},[input]);
  useEffect(()=>{
    const forwarded = sessionStorage.getItem('forward-video');
    if(prefill || !forwarded || autoForwardStarted.current)return;
    autoForwardStarted.current = true;
    void parse(forwarded, true);
  },[parse, prefill]);
  const create=async()=>{if(!parsed)return;setBusy(true);setError('');try{setCreated(await post<Created>('/api/challenges',{videoTicket:parsed.videoTicket,initiator,recipient,message,mode:'classic'}));sessionStorage.removeItem('forward-video');}catch(e){setError(e instanceof Error?e.message:'创建失败');}finally{setBusy(false);}};
  const card=async()=>{if(!created||!parsed)return;downloadBlob(await createShareCard({url:created.challengeUrl,video:parsed.video,heading:'你能绷住吗？',lines:[`${initiator} 向你投来一枚绷绷炸弹`,message||'全程绷住，就算你赢！','挑战链接限时有效']}),'绷绷炸弹-挑战.png');};
  const Root=embedded?'div':'main';return <Root className={embedded?'composer-content':'page'}>{!embedded&&<header className="hero"><p className="eyebrow">BENG BENG BOMB</p><h1>绷绷炸弹</h1><p className="intro">挑一段 B 站视频，看看朋友能绷到第几秒。</p></header>}
    <section className="section"><span className="step">01 · 选视频</span><h2>粘贴 B 站视频</h2><div className="input-row"><input aria-label="B站视频链接" value={input} onChange={e=>setInput(e.target.value)} placeholder="https://www.bilibili.com/video/BV..."/><button disabled={busy||!input.trim()} onClick={()=>void parse()}>{busy?'解析中…':'解析视频'}</button></div><p className="hint">请粘贴 B 站视频页面地址；短链接请先打开后再复制地址。</p>{error&&<p className="error" role="alert">{error}</p>}{parsed&&<VideoPreview video={parsed.video}/>}</section>
    {parsed&&<section className="section"><span className="step">02 · 装填炸弹</span><h2>写下挑战</h2><label>你的昵称 <input className="field" maxLength={CLIENT_CONFIG.limits.nickname} value={initiator} onChange={e=>setInitiator(e.target.value)}/><small>{initiator.length}/{CLIENT_CONFIG.limits.nickname}</small></label><label>挑战对象（可选）<input className="field" maxLength={CLIENT_CONFIG.limits.recipient} value={recipient} onChange={e=>setRecipient(e.target.value)}/></label><label>短留言（可选）<textarea className="field" maxLength={CLIENT_CONFIG.limits.message} value={message} onChange={e=>setMessage(e.target.value)}/><small>{message.length}/{CLIENT_CONFIG.limits.message}</small></label><button disabled={busy||!initiator.trim()} onClick={()=>void create()}>生成挑战</button></section>}
    {created&&<section className="section result"><span className="step">03 · 引爆</span><h2>挑战已装好</h2><LinkBox label="发给朋友的挑战链接" value={created.challengeUrl}/><LinkBox label="自己保存的结果入口" value={created.manageUrl} privateLink/><p className="warning">私密入口可以查看或删除本次结果，请勿转发。挑战链接会在一段时间后失效；完成后的结果会按保存期限保留。</p><div className="button-row"><button onClick={()=>void card()}>下载分享图</button><button className="secondary" onClick={()=>navigator.share?.({title:'绷绷炸弹',url:created.challengeUrl})}>系统分享</button></div></section>}
  </Root>;
}

function VideoPreview({video}:{video:VideoMetadata}){return <div className="video-meta"><div className="video-cover">{video.cover?<img referrerPolicy="no-referrer" src={video.cover} alt="视频封面"/>:<span>无封面</span>}</div><div><p className="video-title">{video.title}</p><p className="video-subtitle">{Math.round(video.duration)} 秒视频</p><p className="muted clamp">{video.description}</p></div></div>}
function LinkBox({label,value,privateLink=false}:{label:string;value:string;privateLink?:boolean}){return <div className={`link-box${privateLink?' private':''}`}><strong>{label}</strong><code aria-label={`${label}已缩略，可点击复制完整链接`}>{compactLink(value, privateLink)}</code><CopyButton value={value}/></div>}
