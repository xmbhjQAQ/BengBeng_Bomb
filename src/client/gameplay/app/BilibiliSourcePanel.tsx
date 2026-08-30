import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatCount,
  formatDuration,
  getBilibiliCoverCandidates,
  type BilibiliVideoData,
  type DanmakuStatus,
} from '../bilibili';
import { t } from '../i18n';

interface BilibiliSourcePanelProps {
  selection: BilibiliVideoData | null;
  loading: boolean;
  error: string | null;
  disabled: boolean;
  onSubmit(input: string): Promise<void>;
}

export function BilibiliSourcePanel({
  selection,
  loading,
  error,
  disabled,
  onSubmit,
}: BilibiliSourcePanelProps) {
  const [input, setInput] = useState('');

  return (
    <section className="section source-panel">
      <h2>{t.video.title}</h2>
      <form
        className="input-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (input.trim()) void onSubmit(input.trim());
        }}
      >
        <label className="sr-only" htmlFor="video-input">{t.video.inputLabel}</label>
        <input
          id="video-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t.video.placeholder}
          autoComplete="off"
          disabled={disabled || loading}
        />
        <button type="submit" disabled={disabled || loading || !input.trim()}>
          {loading ? t.video.parsing : t.video.parse}
        </button>
      </form>
      <p className="hint">{t.video.hint}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {selection && (
        <div className="video-meta">
          <BilibiliCover cover={selection.cover} pic={selection.pic} />
          <div>
            <p className="video-title">{selection.title || '已选择视频'}</p>
            <p className="video-subtitle">
              {selection.duration ? `时长 ${formatDuration(selection.duration)}` : '已选择视频'}
              {typeof selection.view === 'number' ? ` · ${formatCount(selection.view)} 播放` : ''}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export function BilibiliCover({
  cover,
  pic,
  className = '',
}: {
  cover?: string;
  pic?: string;
  className?: string;
}) {
  const candidates = useMemo(() => getBilibiliCoverCandidates({ cover, pic }), [cover, pic]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const imageMountRef = useRef<HTMLSpanElement>(null);

  useEffect(() => setCandidateIndex(0), [candidates]);

  const src = candidates[candidateIndex];
  useEffect(() => {
    const mount = imageMountRef.current;
    if (!mount) return;
    mount.replaceChildren();
    if (!src) return;

    // B站 CDN rejects requests carrying the page Referer. Set this before
    // assigning src so the very first request is made without that header.
    const image = new Image();
    image.className = 'video-cover-image';
    image.alt = '视频封面';
    image.referrerPolicy = 'no-referrer';
    image.setAttribute('referrerpolicy', 'no-referrer');
    image.loading = 'eager';
    image.decoding = 'async';
    const handleError = () => setCandidateIndex((index) => index + 1);
    image.addEventListener('error', handleError);
    image.src = src;
    mount.append(image);

    return () => {
      image.removeEventListener('error', handleError);
      image.src = '';
    };
  }, [src]);

  return (
    <div
      className={`video-cover${className ? ` ${className}` : ''}${src ? '' : ' video-cover-fallback'}`}
      aria-label={src ? '视频封面' : '视频封面加载失败'}
    >
      <span ref={imageMountRef} className="video-cover-mount" />
      {!src && <span>封面加载失败</span>}
    </div>
  );
}

export function DanmakuNotice({ status }: { status: DanmakuStatus }) {
  if (status === 'ready') return <p className="success">{t.video.danmakuReady}</p>;
  if (status === 'error') return <p className="warning">{t.video.danmakuFailed}</p>;
  if (status === 'loading') return <p className="muted">{t.video.danmakuLoading}</p>;
  return null;
}
