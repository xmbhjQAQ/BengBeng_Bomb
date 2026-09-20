import { useCallback, useEffect, useRef, useState } from 'react';
import { post } from '../api/client';
import { createShareCard, downloadBlob } from '../sharing/card';
import { CLIENT_CONFIG } from '../../shared/config/client';
import type { PlaybackData, VideoMetadata } from '../../shared/contracts';
import { compactLink } from './linkDisplay';
import { CopyButton } from './CopyButton';
import { copyText } from './copyText';
import { shareImageFile } from './shareImage';
import { normalizeGroupCreated } from './groupTypes';
import { readSession, removeSession } from '../storage/session';
import { upsertCreatedChallenge } from '../storage/createdChallenges';
import { readPreferredNickname, rememberPreferredNickname } from '../storage/preferredNickname';

export interface ParsedVideo {
  video: PlaybackData;
  videoTicket: string;
}

interface Created {
  challengeUrl: string;
  manageUrl: string;
  expiresAt: number;
  resultUrl?: string;
  resultExpiresAt?: number;
  entryUrl?: string;
  group?: boolean;
}

type ShareImageStatus = 'idle' | 'generating' | 'ready' | 'error';
const BILIBILI_HOSTS = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com', 'b23.tv']);

function normalizeBilibiliShareInput(value: string) {
  const raw = value.trim();
  if (!raw) return raw;
  const candidates = raw.match(/https?:\/\/[^\s<>"'`]+/giu) ?? [];
  const urls = candidates.map((candidate) => candidate.replace(/[)\]}>{},，。！？；：、"'’”]+$/gu, '')).filter((candidate) => {
    try {
      return BILIBILI_HOSTS.has(new URL(candidate).hostname.toLowerCase());
    } catch {
      return false;
    }
  });
  const uniqueUrls = [...new Set(urls)];
  if (uniqueUrls.length > 1) throw new Error('检测到多个 B 站链接，请只保留一个。');
  return uniqueUrls[0] ?? raw;
}

export function ComposerView({ embedded = false, prefill }: { embedded?: boolean; prefill?: ParsedVideo | null }) {
  const [input, setInput] = useState(readSession('forward-video') || '');
  const [parsed, setParsed] = useState<ParsedVideo | null>(prefill ?? null);
  const [created, setCreated] = useState<Created | null>(null);
  const [initiator, setInitiator] = useState(readPreferredNickname);
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'classic' | 'group'>('classic');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shareFile, setShareFile] = useState<File | null>(null);
  const [shareImageStatus, setShareImageStatus] = useState<ShareImageStatus>('idle');
  const [shareFeedback, setShareFeedback] = useState('');
  const [showShareCopy, setShowShareCopy] = useState(false);
  const autoForwardStarted = useRef(false);

  useEffect(() => {
    if (!prefill) return;
    setParsed(prefill);
    setInput(`https://www.bilibili.com/video/${prefill.video.bvid}`);
    setCreated(null);
    setError('');
  }, [prefill]);

  const parse = useCallback(async (value = input, clearForward = false) => {
    setBusy(true);
    setError('');
    try {
      setParsed(await post<ParsedVideo>('/api/bilibili/parse', { input: normalizeBilibiliShareInput(value) }));
      setCreated(null);
      if (clearForward || value === input) removeSession('forward-video');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '解析失败');
    } finally {
      setBusy(false);
    }
  }, [input]);

  useEffect(() => {
    const forwarded = readSession('forward-video');
    if (prefill || !forwarded || autoForwardStarted.current) return;
    autoForwardStarted.current = true;
    void parse(forwarded, true);
  }, [parse, prefill]);

  const create = async () => {
    if (!parsed) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'group') {
        const response = normalizeGroupCreated(await post<unknown>('/api/challenges', {
          videoTicket: parsed.videoTicket,
          initiator,
          message,
          mode: 'group',
        }));
        const entryUrl = response.entryUrl || response.invitationUrl;
        if (!entryUrl || !response.resultUrl) throw new Error('群组挑战链接生成失败');
        const nextCreated: Created = {
          challengeUrl: entryUrl,
          entryUrl,
          resultUrl: response.resultUrl,
          manageUrl: response.manageUrl || '',
          expiresAt: response.expiresAt || 0,
          resultExpiresAt: response.resultExpiresAt,
          group: true,
        };
        setCreated(nextCreated);
        rememberPreferredNickname(initiator);
        upsertCreatedChallenge({
          kind: 'group',
          video: parsed.video,
          createdAt: Math.floor(Date.now() / 1000),
          expiresAt: nextCreated.expiresAt,
          challengeUrl: nextCreated.challengeUrl,
          entryUrl: nextCreated.entryUrl,
          resultUrl: nextCreated.resultUrl,
          resultExpiresAt: nextCreated.resultExpiresAt,
          manageUrl: nextCreated.manageUrl,
          initiator,
        });
      } else {
        const nextCreated: Created = {
          ...await post<Created>('/api/challenges', {
            videoTicket: parsed.videoTicket,
            initiator,
            recipient,
            message,
            mode: 'classic',
          }),
          group: false,
        };
        setCreated(nextCreated);
        rememberPreferredNickname(initiator);
        upsertCreatedChallenge({
          kind: 'classic',
          video: parsed.video,
          createdAt: Math.floor(Date.now() / 1000),
          expiresAt: nextCreated.expiresAt,
          challengeUrl: nextCreated.challengeUrl,
          manageUrl: nextCreated.manageUrl,
          initiator,
        });
      }
      removeSession('forward-video');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建失败');
    } finally {
      setBusy(false);
    }
  };

  const makeShareFile = useCallback(async (): Promise<File> => {
    if (!created || !parsed) throw new Error('分享图内容暂不可用');
    const blob = await createShareCard({
      url: created.challengeUrl,
      video: parsed.video,
      heading: created.group ? '群组挑战' : '你能绷住吗？',
      lines: [
        created.group ? '发到群里，扫码后可参加或查看结果' : `${initiator} 向你投来一枚绷绷炸弹`,
        message || '看看你能否绷住。',
        '挑战链接限时有效',
      ],
      qrLabel: created.group ? '群组统一入口' : undefined,
    });
    return new File([blob], created.group ? '绷绷炸弹-群组挑战.png' : '绷绷炸弹-挑战.png', { type: 'image/png' });
  }, [created, initiator, message, parsed]);

  // Prepare the image before the click so the native share call still has a
  // user activation when it receives the already-created File object.
  useEffect(() => {
    let active = true;
    if (!created || !parsed) {
      setShareFile(null);
      setShareImageStatus('idle');
      setShareFeedback('');
      setShowShareCopy(false);
      return () => { active = false; };
    }
    setShareFile(null);
    setShareImageStatus('generating');
    setShareFeedback('');
    setShowShareCopy(false);
    void makeShareFile()
      .then((file) => {
        if (!active) return;
        setShareFile(file);
        setShareImageStatus('ready');
      })
      .catch((reason) => {
        if (!active) return;
        setShareImageStatus('error');
        setShareFeedback(reason instanceof Error ? reason.message : '分享图生成失败，请重试');
      });
    return () => { active = false; };
  }, [created, makeShareFile, parsed]);

  const shareCopy = created
    ? created.group
      ? `来参加绷绷炸弹群组挑战，扫码后可参加或查看结果：${created.challengeUrl}`
      : `${initiator || '朋友'}向你发来一枚绷绷炸弹，看看你能否绷住：${created.challengeUrl}`
    : '';

  const copyShareFallback = async () => {
    if (!shareCopy) return;
    setShowShareCopy(true);
    try {
      await copyText(shareCopy);
      setShareFeedback('当前浏览器不支持图片分享，分享文案已复制。');
    } catch {
      setShareFeedback('当前浏览器不支持图片分享，请点击“复制分享文案”。');
    }
  };

  const shareImage = async () => {
    if (!created) return;
    setShareFeedback('');
    if (!shareFile) {
      if (shareImageStatus === 'generating') {
        setShareFeedback('分享图正在准备，请稍后再试。');
      } else {
        await copyShareFallback();
      }
      return;
    }

    const result = await shareImageFile(shareFile, shareCopy);
    if (result.status === 'shared') {
      setShareFeedback('分享图已送出。');
    } else if (result.status === 'cancelled') {
      setShareFeedback('已取消系统分享。');
    } else if (result.status === 'image-copied') {
      setShowShareCopy(true);
      setShareFeedback('图片已复制，可粘贴到聊天窗口；也可以复制分享文案。');
    } else if (result.status === 'text-copied') {
      setShowShareCopy(true);
      setShareFeedback('当前浏览器不支持图片分享，分享文案已复制。');
    } else {
      setShowShareCopy(true);
      setShareFeedback('当前浏览器不支持图片分享，请点击“复制分享文案”或下载分享图。');
    }
  };

  const downloadShareImage = async () => {
    if (!created || !parsed) return;
    setShareFeedback('');
    try {
      const file = shareFile ?? await makeShareFile();
      if (!shareFile) {
        setShareFile(file);
        setShareImageStatus('ready');
      }
      downloadBlob(file, file.name);
      setShareFeedback('分享图已下载。');
    } catch (reason) {
      setShareImageStatus('error');
      setShareFeedback(reason instanceof Error ? reason.message : '分享图生成失败，请重试');
    }
  };

  const Root = embedded ? 'div' : 'main';
  return <Root className={embedded ? 'composer-content' : 'page'}>
    {!embedded && <header className="hero"><p className="eyebrow">BENG BENG BOMB</p><h1>绷绷炸弹</h1><p className="intro">挑一段 B 站视频，看看朋友能绷到第几秒。</p></header>}
    <section className="section">
      <span className="step">01 · 选视频</span>
      <h2>粘贴 B 站视频</h2>
      <div className="input-row">
        <input aria-label="B站视频链接" value={input} onChange={(event) => setInput(event.target.value)} placeholder="https://www.bilibili.com/video/BV..." />
        <button disabled={busy || !input.trim()} onClick={() => void parse()}>{busy ? '解析中…' : '解析视频'}</button>
      </div>
      <p className="hint">支持 B 站视频页面和 b23.tv 短链接，粘贴后即可解析。</p>
      {error && <p className="error" role="alert">{error}</p>}
      {parsed && <VideoPreview video={parsed.video} />}
    </section>
    {parsed && <section className="section">
      <span className="step">02 · 装填炸弹</span>
      <h2>选择挑战方式</h2>
      <div className="mode-picker" role="radiogroup" aria-label="挑战方式">
        <button type="button" role="radio" aria-checked={mode === 'classic'} className={mode === 'classic' ? 'active' : ''} onClick={() => { setMode('classic'); setCreated(null); }}>单人挑战</button>
        <button type="button" role="radio" aria-checked={mode === 'group'} className={mode === 'group' ? 'active' : ''} onClick={() => { setMode('group'); setCreated(null); }}>群组挑战</button>
      </div>
      <p className="hint">{mode === 'group' ? '发到群里，大家各自挑战，结果会按昵称展示。' : '发给一位朋友，记录这一次挑战结果。'}</p>
      <label>{mode === 'group' ? '发起者昵称' : '你的昵称'} <input className="field" maxLength={CLIENT_CONFIG.limits.nickname} value={initiator} onChange={(event) => setInitiator(event.target.value)} onBlur={() => rememberPreferredNickname(initiator)} /><small>{initiator.length}/{CLIENT_CONFIG.limits.nickname}</small></label>
      {mode === 'classic' && <label>挑战对象（可选）<input className="field" maxLength={CLIENT_CONFIG.limits.recipient} value={recipient} onChange={(event) => setRecipient(event.target.value)} /></label>}
      <label>短留言（可选）<textarea className="field" maxLength={CLIENT_CONFIG.limits.message} value={message} onChange={(event) => setMessage(event.target.value)} /><small>{message.length}/{CLIENT_CONFIG.limits.message}</small></label>
      <button disabled={busy || !initiator.trim()} onClick={() => void create()}>生成挑战</button>
    </section>}
    {created && <section className="section result">
      <span className="step">03 · 引爆</span>
      <h2>{created.group ? '群组挑战已装好' : '挑战已装好'}</h2>
      <LinkBox label={created.group ? '群组统一入口链接' : '发给朋友的挑战链接'} value={created.challengeUrl} />
      {created.group && created.resultUrl && <LinkBox label="群组结果链接" value={created.resultUrl} />}
      {created.manageUrl && <LinkBox label="自己保存的结果入口" value={created.manageUrl} privateLink />}
      {created.group
        ? <p className="warning">把统一入口发到群里，扫码后可以选择参加挑战或查看目前结果；参与时间结束后，结果仍会保留一段时间。</p>
        : <p className="warning">私密入口可以查看或删除本次结果，请勿转发。挑战链接会在一段时间后失效；完成后的结果会按保存期限保留。</p>}
      <div className="button-row">
        <button type="button" onClick={() => void downloadShareImage()} disabled={shareImageStatus === 'generating'} aria-busy={shareImageStatus === 'generating'}>
          {shareImageStatus === 'generating' ? '正在准备分享图…' : shareImageStatus === 'error' ? '重新生成分享图' : '下载分享图'}
        </button>
        <button type="button" className="secondary" onClick={() => void shareImage()} disabled={shareImageStatus === 'generating'} aria-busy={shareImageStatus === 'generating'}>
          {shareImageStatus === 'generating' ? '正在准备图片…' : '系统分享图片'}
        </button>
        {showShareCopy && <CopyButton value={shareCopy} label="复制分享文案" />}
      </div>
      {shareFeedback && <p className="share-feedback" role="status">{shareFeedback}</p>}
    </section>}
  </Root>;
}

function VideoPreview({ video }: { video: VideoMetadata }) {
  return <div className="video-meta"><div className="video-cover">{video.cover ? <img referrerPolicy="no-referrer" src={video.cover} alt="视频封面" /> : <span>无封面</span>}</div><div><p className="video-title">{video.title}</p><p className="video-subtitle">{Math.round(video.duration)} 秒视频</p><p className="muted clamp">{video.description}</p></div></div>;
}

function LinkBox({ label, value, privateLink = false }: { label: string; value: string; privateLink?: boolean }) {
  return <div className={`link-box${privateLink ? ' private' : ''}`}><strong>{label}</strong><code aria-label={`${label}已缩略，可点击复制完整链接`}>{compactLink(value, privateLink)}</code><CopyButton value={value} /></div>;
}
