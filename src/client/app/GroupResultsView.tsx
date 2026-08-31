import { useCallback, useEffect, useState } from 'react';
import { post } from '../api/client';
import { CopyButton } from './CopyButton';
import { compactLink } from './linkDisplay';
import { PublicQrCode } from './PublicQrCode';
import { GroupParticipantList } from './GroupParticipantList';
import { normalizeGroupResults, type GroupResultPage } from './groupTypes';
import { Stats } from './Settlement';

export function GroupResultsView({ token }: { token: string }) {
  const [data, setData] = useState<GroupResultPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const resultUrl = typeof window === 'undefined' ? '' : window.location.href;

  const load = useCallback(async (cursor?: string) => {
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const next = normalizeGroupResults(await post<unknown>('/api/groups/results', { resultToken: token, ...(cursor ? { cursor } : {}) }));
      setData((previous) => cursor && previous
        ? { ...next, participants: [...previous.participants, ...next.participants] }
        : next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '群组结果暂时无法打开');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <main className="page group-results-page"><section className="section"><p role="status">正在打开群组结果…</p></section></main>;
  if (error && !data) return <main className="page group-results-page"><section className="section"><h1>群组结果暂时无法打开</h1><p className="error" role="alert">{error}</p><button type="button" onClick={() => void load()}>重新加载</button></section></main>;
  if (!data) return null;

  const expired = data.state === 'expired';
  const ended = data.state === 'ended';
  const unopened = data.state === 'unopened';
  return (
    <main className="page group-results-page">
      <header className="hero compact">
        <p className="eyebrow">群组挑战</p>
        <h1>{data.video?.title || '群组结果'}</h1>
        <p className="intro">{expired ? '这组挑战的参与时间已结束，以下是仍在保存期内的结果。' : ended ? '这组挑战已经结束，以下是已完成的结果。' : unopened ? '这组挑战尚未打开，或结果已经销毁。' : '看看群友们都坚持到了第几秒。'}</p>
      </header>
      <section className="section group-results-share">
        <div>
          <p className="step">公开结果</p>
          <h2>把结果发回群里</h2>
          <p className="muted">结果只展示昵称、完成状态和坚持时间，不会公开摄像头画面或表情曲线。</p>
          <div className="link-box"><strong>结果链接</strong><code aria-label="结果链接已缩略，可点击复制完整链接">{compactLink(resultUrl)}</code><CopyButton value={resultUrl} label="复制结果链接" /></div>
        </div>
        <PublicQrCode url={resultUrl} label="扫码查看结果" />
      </section>
      {data.stats && <Stats stats={data.stats} />}
      <section className="section">
        <div className="group-results-heading"><div><p className="step">参与记录</p><h2>谁最能绷</h2></div>{typeof data.total === 'number' && <span className="group-results-total">已完成 {data.total} 人</span>}</div>
        <GroupParticipantList participants={data.participants} />
        {error && <p className="error" role="alert">{error}</p>}
        {data.nextCursor && !unopened && <button type="button" className="secondary group-load-more" disabled={loadingMore} onClick={() => void load(data.nextCursor!)}>{loadingMore ? '加载中…' : '加载更多结果'}</button>}
      </section>
      <p className="hint group-results-footnote">公开结果会在保存期限后自动清除。</p>
    </main>
  );
}
