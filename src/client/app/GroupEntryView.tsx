import { useCallback, useEffect, useState } from 'react';
import { post } from '../api/client';
import { CopyButton } from './CopyButton';
import { compactLink } from './linkDisplay';
import { normalizeGroupEntry, type GroupEntryPage } from './groupTypes';

type Navigate = (path: string) => void;

/**
 * The single public landing page for a group QR/link.  It resolves the
 * stateless entry capability once, then lets the visitor choose a same-page
 * SPA transition into participation or the retained public results.
 */
export function GroupEntryView({ token, navigate }: { token: string; navigate: Navigate }) {
  const [data, setData] = useState<GroupEntryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(normalizeGroupEntry(await post<unknown>('/api/groups/entry', { entryToken: token })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '群组入口暂时无法打开');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const go = (url: string) => {
    try {
      const target = new URL(url, window.location.origin);
      navigate(`${target.pathname}${target.search}${target.hash}`);
    } catch {
      setError('链接暂时无法打开，请重新加载入口。');
    }
  };

  if (loading) return <main className="page group-entry-page"><section className="section"><p role="status">正在打开群组入口…</p></section></main>;
  if (error || !data) return <main className="page group-entry-page"><section className="section"><h1>群组入口暂时无法打开</h1><p className="error" role="alert">{error || '入口内容不完整，请重新获取分享链接。'}</p><button type="button" onClick={() => void load()}>重新加载</button></section></main>;

  const statusCopy = data.state === 'active'
    ? '参与时间还没结束，选一个方式继续。'
    : data.state === 'ended'
      ? '这组挑战已经结束，仍可查看已完成的结果。'
      : data.state === 'expired'
        ? '参与时间已结束，以下结果还在保存期内。'
        : '这组挑战尚未打开，或结果已经销毁。';
  const completed = data.resultPage.total ?? data.resultPage.stats?.total ?? 0;

  return <main className="page group-entry-page">
    <header className="hero compact">
      <p className="eyebrow">群组挑战入口</p>
      <h1>{data.video.title}</h1>
      <p className="intro">一个入口，参加挑战或查看群友目前的结果。</p>
    </header>
    <section className="section group-entry-card">
      <div className="video-meta group-entry-video">
        <div className="video-cover">{data.video.cover ? <img referrerPolicy="no-referrer" src={data.video.cover} alt="视频封面" /> : <span>无封面</span>}</div>
        <div><p className="video-title">{data.video.title}</p><p className="video-subtitle">{Math.round(data.video.duration)} 秒视频 · 已完成 {completed} 人</p></div>
      </div>
      {(data.initiator || data.message) && <div className="group-entry-message">{data.initiator && <p><strong>{data.initiator}</strong> 发起了这组挑战</p>}{data.message && <p>{data.message}</p>}</div>}
      <p className={`group-entry-status ${data.state}`} role="status">{statusCopy}</p>
      <div className="group-entry-actions">
        {data.canParticipate && data.invitationUrl && <button type="button" onClick={() => go(data.invitationUrl!)}>参加挑战</button>}
        <button type="button" className="secondary" onClick={() => go(data.resultUrl)}>查看目前结果</button>
      </div>
      <div className="link-box group-entry-result-link"><strong>结果链接</strong><code aria-label="结果链接已缩略，可点击复制完整链接">{compactLink(data.resultUrl)}</code><CopyButton value={data.resultUrl} label="复制结果链接" /></div>
      <p className="hint">结果只展示昵称、完成状态和坚持时间，不会公开摄像头画面或表情曲线。</p>
    </section>
  </main>;
}

