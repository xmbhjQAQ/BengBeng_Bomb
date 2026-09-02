import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError, post } from '../api/client';
import { decodeScoreTrace, isRecord, type AggregateStats, type PlaybackData, type ScorePoint } from '../../shared/contracts';
import { CLIENT_CONFIG } from '../../shared/config/client';
import { useSmileDemo } from '../gameplay/app/useSmileDemo';
import { CameraPanel } from '../gameplay/app/CameraPanel';
import { ChallengePanel } from '../gameplay/app/ChallengePanel';
import { invalidReasonText } from '../gameplay/app/viewText';
import { Settlement } from './Settlement';
import { RECIPIENT_STEPS, recipientStage, type RecipientStage } from './recipientFlow';
import { normalizeGroupComplete, normalizeGroupOpen, type ChallengeDisplayPayload, type GroupCompleted } from './groupTypes';
import { readSession, removeSession, writeSession } from '../storage/session';
import {
  readActiveAttempt,
  removeActiveAttempt,
  subscribeActiveAttempts,
  writeActiveAttempt,
} from '../storage/activeAttempts';
import { readPreferredNickname, rememberPreferredNickname } from '../storage/preferredNickname';

interface Opened {
  challenge: ChallengeDisplayPayload;
  playback: PlaybackData;
  stats: AggregateStats;
  session: { state: 'opened' | 'started' | 'completed'; result_expires_at?: number | null } | null;
}

interface Completed {
  outcome: 'held' | 'failed';
  elapsedSeconds: number;
  reportUrl?: string;
  stats: AggregateStats;
  scoreTrace?: ReadonlyArray<Readonly<ScorePoint>>;
  resultUrl?: string;
  groupParticipants?: GroupCompleted['participants'];
  groupNextCursor?: string | null;
  groupTotal?: number;
}

type Submission = { status: 'idle' | 'submitting' | 'error'; error: string };

interface AttemptState {
  attemptToken: string;
  attemptId: string;
  source: 'none' | 'persistent' | 'legacy';
}

const attemptKey = (token: string, group = false) => `${group ? 'bengbeng-group-attempt' : 'bengbeng-attempt'}:${token}`;
const groupAttemptIdKey = (token: string) => `bengbeng-group-attempt-id:${token}`;
const completedKey = (token: string) => `bengbeng-completed:${token}`;

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function readCachedCompleted(token: string, durationSeconds: number): Completed | null {
  const key = completedKey(token);
  const raw = readSession(key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || (value.outcome !== 'held' && value.outcome !== 'failed') || typeof value.reportUrl !== 'string' || !value.reportUrl) throw new Error('invalid completed result');
    if (!finiteNumber(value.elapsedSeconds) || value.elapsedSeconds < 0 || value.elapsedSeconds > durationSeconds + 3) throw new Error('invalid completed elapsed');
    if (!isRecord(value.stats)) throw new Error('invalid completed stats');
    const stats = value.stats;
    const integerStats = ['total', 'held', 'failed'] as const;
    if (!integerStats.every((name) => Number.isInteger(stats[name]) && Number(stats[name]) >= 0)) throw new Error('invalid completed counts');
    if (Number(stats.held) + Number(stats.failed) > Number(stats.total) || !finiteNumber(stats.failureRate) || stats.failureRate < 0 || stats.failureRate > 1 || !finiteNumber(stats.averageElapsedSeconds) || stats.averageElapsedSeconds < 0 || !Array.isArray(stats.buckets)) throw new Error('invalid completed stats');
    const buckets = stats.buckets.map((bucket) => {
      if (!isRecord(bucket) || !finiteNumber(bucket.startSeconds) || bucket.startSeconds < 0 || !finiteNumber(bucket.count) || !Number.isInteger(bucket.count) || bucket.count < 0) throw new Error('invalid completed bucket');
      return { startSeconds: bucket.startSeconds, count: bucket.count };
    });
    const scoreTrace = decodeScoreTrace(value.scoreTrace ?? [], durationSeconds);
    return {
      outcome: value.outcome,
      elapsedSeconds: value.elapsedSeconds,
      reportUrl: value.reportUrl,
      stats: {
        total: Number(stats.total), held: Number(stats.held), failed: Number(stats.failed),
        failureRate: stats.failureRate, averageElapsedSeconds: stats.averageElapsedSeconds, buckets,
      },
      scoreTrace,
    };
  } catch {
    removeSession(key);
    return null;
  }
}

const clearCachedCompleted = (token: string) => removeSession(completedKey(token));

function initialAttemptState(token: string, group: boolean): AttemptState {
  const kind = group ? 'group' : 'single';
  const active = readActiveAttempt(kind, token);
  if (active) {
    return {
      attemptToken: active.attemptToken,
      attemptId: active.kind === 'group' ? active.attemptId : '',
      source: 'persistent',
    };
  }
  const legacyAttempt = readSession(attemptKey(token, group)) || '';
  const legacyAttemptId = group ? readSession(groupAttemptIdKey(token)) || '' : '';
  // A group completion needs both values.  Never migrate or reuse a partial
  // legacy record because an invented/missing attempt id cannot be authorized.
  if (legacyAttempt && (!group || legacyAttemptId)) {
    return { attemptToken: legacyAttempt, attemptId: legacyAttemptId, source: 'legacy' };
  }
  if (group && (legacyAttempt || legacyAttemptId)) {
    removeSession(attemptKey(token, true));
    removeSession(groupAttemptIdKey(token));
  }
  return { attemptToken: '', attemptId: '', source: 'none' };
}

function isTerminalAttemptError(error: unknown, group: boolean): boolean {
  if (!(error instanceof ApiClientError)) return false;
  const common = ['NOT_FOUND', 'TOKEN_EXPIRED'] as const;
  const single = ['INVALID_TOKEN', 'INVALID_ATTEMPT'] as const;
  const grouped = ['INVALID_GROUP_TOKEN', 'INVALID_GROUP_ATTEMPT', 'GROUP_NOT_FOUND', 'GROUP_ENDED', 'GROUP_EXPIRED'] as const;
  return [...common, ...(group ? grouped : single)].includes(error.code as never);
}

export function ChallengeView({ token, group = false }: { token: string; group?: boolean }) {
  const demo = useSmileDemo();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [attemptState, setAttemptState] = useState(() => initialAttemptState(token, group));
  const [completed, setCompleted] = useState<Completed | null>(null);
  const [openError, setOpenError] = useState('');
  const [startError, setStartError] = useState('');
  const [nickname, setNickname] = useState(() => {
    const active = group ? readActiveAttempt('group', token) : null;
    return active?.kind === 'group' ? active.nickname ?? readPreferredNickname() : readPreferredNickname();
  });
  const [nicknameError, setNicknameError] = useState('');
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [attemptUnavailable, setAttemptUnavailable] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [submission, setSubmission] = useState<Submission>({ status: 'idle', error: '' });
  const loaded = useRef(false);
  const submitting = useRef(false);
  const clearingAttempt = useRef(false);
  const localResult = demo.result;
  const closeCamera = demo.closeCamera;
  const attempt = attemptState.attemptToken;
  const groupAttemptId = attemptState.attemptId;
  const attemptKind = group ? 'group' : 'single';

  const clearAttempt = useCallback(() => {
    clearingAttempt.current = true;
    // Only remove the credential this component actually owns. With no local
    // bearer, another tab may have started a newer group participation after
    // this component mounted and that record must remain recoverable.
    if (attempt) removeActiveAttempt(attemptKind, token, attempt);
    removeSession(attemptKey(token, group));
    if (group) removeSession(groupAttemptIdKey(token));
    setAttemptState({ attemptToken: '', attemptId: '', source: 'none' });
    queueMicrotask(() => { clearingAttempt.current = false; });
  }, [attempt, attemptKind, group, token]);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void post<unknown>(group ? '/api/groups/open' : '/api/challenges/open', group ? { groupToken: token } : { challengeToken: token })
      .then((raw) => {
        const value = group ? normalizeGroupOpen(raw) : raw as Opened;
        const groupState = group ? (value as ReturnType<typeof normalizeGroupOpen>).group?.state : undefined;
        const groupCanRecover = groupState !== 'ended' && groupState !== 'expired';
        if (value.session?.state === 'completed') {
          clearAttempt();
          const expiresAt = value.session.result_expires_at;
          const resultIsCurrent = expiresAt === undefined || (typeof expiresAt === 'number' && expiresAt > Math.floor(Date.now() / 1000));
          const cached = !group && resultIsCurrent ? readCachedCompleted(token, value.challenge.video.duration) : null;
          if (cached) setCompleted(cached);
          else if (!group) clearCachedCompleted(token);
        } else {
          if (!group) clearCachedCompleted(token);
        }
        if (group && !groupCanRecover) {
          clearAttempt();
        } else if (!group && value.session?.state === 'opened' && attemptState.attemptToken) {
          // D1 is authoritative. A local bearer cannot be reused when the
          // server says this challenge has never been claimed.
          clearAttempt();
        } else if (attemptState.attemptToken && (group || value.session?.state === 'started')) {
          const migrated = attemptState.source === 'legacy' && writeActiveAttempt(group
              ? {
                  kind: 'group',
                  challengeToken: token,
                  attemptToken: attemptState.attemptToken,
                  attemptId: attemptState.attemptId,
                  ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
                  startedAt: Math.floor(Date.now() / 1000),
                  expiresAt: value.challenge.expiresAt,
                }
              : {
                  kind: 'single',
                  challengeToken: token,
                  attemptToken: attemptState.attemptToken,
                  startedAt: Math.floor(Date.now() / 1000),
                  expiresAt: value.challenge.expiresAt,
                });
          if (migrated) {
            setAttemptState((current) => ({ ...current, source: 'persistent' }));
          }
          setRecoveryPending(true);
        }
        setOpened(value);
        demo.selectResolvedBilibili(value.playback);
      })
      .catch((error) => {
        if (isTerminalAttemptError(error, group)) clearAttempt();
        setOpenError(error instanceof Error ? error.message : '挑战加载失败');
      });
  }, [attemptState.attemptId, attemptState.attemptToken, attemptState.source, clearAttempt, demo, group, nickname, token]);

  useEffect(() => subscribeActiveAttempts(() => {
    if (clearingAttempt.current || !attempt) return;
    const active = readActiveAttempt(attemptKind, token);
    if (active?.attemptToken === attempt) return;
    removeSession(attemptKey(token, group));
    if (group) removeSession(groupAttemptIdKey(token));
    setAttemptState({ attemptToken: '', attemptId: '', source: 'none' });
    setRecoveryPending(false);
    setAttemptUnavailable('这轮挑战可能已在其他页面完成或失效，请重新打开链接查看最新状态。');
    closeCamera();
  }), [attempt, attemptKind, closeCamera, group, token]);

  const submitResult = useCallback(async () => {
    if (!localResult || !attempt || submitting.current) return;
    submitting.current = true;
    closeCamera();
    setSubmission({ status: 'submitting', error: '' });
    try {
      const body = {
        ...(group ? { groupToken: token } : { challengeToken: token }),
        attemptToken: attempt,
        ...(group ? { attemptId: groupAttemptId } : {}),
        outcome: localResult.outcome === 'completed' ? 'held' : 'failed',
        elapsedSeconds: localResult.videoPositionSeconds,
        scoreTrace: localResult.scoreTrace,
      };
      const raw = await post<unknown>(group ? '/api/groups/complete' : '/api/challenges/complete', body);
      const value: Completed = group
        ? (() => { const result = normalizeGroupComplete(raw); return { ...result, resultUrl: result.resultUrl || undefined, groupParticipants: result.participants, groupNextCursor: result.nextCursor, groupTotal: result.total, scoreTrace: localResult.scoreTrace }; })()
        : { ...(raw as Completed), scoreTrace: localResult.scoreTrace };
      clearAttempt();
      const completedValue = value;
      setCompleted(completedValue);
      if (!group) {
        writeSession(completedKey(token), JSON.stringify(completedValue));
      }
      setSubmission({ status: 'idle', error: '' });
      void document.exitFullscreen?.().catch(() => undefined);
    } catch (error) {
      submitting.current = false;
      if (isTerminalAttemptError(error, group)) {
        clearAttempt();
        setAttemptUnavailable(error instanceof Error ? error.message : '本轮挑战已经失效，请重新打开挑战链接。');
        setSubmission({ status: 'idle', error: '' });
        return;
      }
      setSubmission({
        status: 'error',
        error: error instanceof Error ? error.message : '结果提交失败',
      });
    }
  }, [attempt, clearAttempt, closeCamera, group, groupAttemptId, localResult, token]);

  useEffect(() => {
    if (localResult) void submitResult();
  }, [localResult, submitResult]);

  const start = async () => {
    if (!opened || !demo.canStart || starting) return;
    if (group && !attempt && !nickname.trim()) {
      setNicknameError('请先填写昵称，再开始挑战。');
      return;
    }
    setStarting(true);
    setStartError('');
    setNicknameError('');
    try {
      let currentAttempt = attempt;
      let currentAttemptId = groupAttemptId;
      if (!currentAttempt) {
        const value = await post<{ attemptToken: string; attemptId?: string }>(group ? '/api/groups/start' : '/api/challenges/start', group
          ? { groupToken: token, nickname: nickname.trim() }
          : { challengeToken: token });
        currentAttempt = value.attemptToken;
        currentAttemptId = value.attemptId ?? '';
        if (group && !currentAttemptId) throw new Error('本轮挑战信息不完整，请重新进入挑战。');
        const persisted = writeActiveAttempt(group
          ? {
              kind: 'group', challengeToken: token, attemptToken: currentAttempt,
              attemptId: currentAttemptId, nickname: nickname.trim(),
              startedAt: Math.floor(Date.now() / 1000), expiresAt: opened.challenge.expiresAt,
            }
          : {
              kind: 'single', challengeToken: token, attemptToken: currentAttempt,
              startedAt: Math.floor(Date.now() / 1000), expiresAt: opened.challenge.expiresAt,
            });
        writeSession(attemptKey(token, group), currentAttempt);
        if (group) {
          writeSession(groupAttemptIdKey(token), currentAttemptId);
        }
        setAttemptState({ attemptToken: currentAttempt, attemptId: currentAttemptId, source: persisted ? 'persistent' : 'legacy' });
      }
      if (group) rememberPreferredNickname(nickname);
      try {
        await document.documentElement.requestFullscreen?.();
      } catch {
        // iOS and embedded browsers use the fixed immersive page fallback.
      }
      demo.startChallenge();
    } catch (error) {
      setStartError(error instanceof Error ? error.message : '开始失败');
    } finally {
      setStarting(false);
    }
  };

  if (openError && !opened) return <Message title="挑战无法打开" detail={openError} />;
  if (!opened) return <Message title="正在拆弹…" detail="正在准备挑战视频，请稍候。" />;
  if (attemptUnavailable) return <Message title="本轮挑战已结束" detail={attemptUnavailable} />;
  if (opened.session?.state === 'completed' && !completed) {
    return <Message title="这枚炸弹已经引爆过了" detail="这次挑战已经完成，每个挑战只能记录一次结果。请回到发起者保存的结果入口查看详情。" />;
  }
  if (opened.session?.state === 'started' && !attempt && !completed) {
    return <Message title="挑战已经开始" detail="这次挑战已经在别处开始，请从原来的页面继续。" />;
  }
  if (recoveryPending) {
    return (
      <main className="page challenge-page">
        <header className="hero compact">
          <p className="eyebrow">继续挑战</p>
          <h1>上次挑战还没有完成</h1>
          <p className="intro">本机保存了这轮挑战资格，你可以从头重新挑战。</p>
        </header>
        <section className="section invalid-panel" aria-labelledby="challenge-recovery-title">
          <p className="step">恢复挑战</p>
          <h2 id="challenge-recovery-title">重新校准后再出发</h2>
          <p>摄像头画面、校准信息和上次进度都没有保存。继续后会重新校准，并从视频开头开始，不会创建新的挑战记录。</p>
          {group && nickname && <p>本轮仍使用昵称“{nickname}”。</p>}
          <button type="button" onClick={() => setRecoveryPending(false)}>重新开始本轮</button>
        </section>
      </main>
    );
  }

  const stage = recipientStage({
    accepted,
    phase: demo.phase,
    hasLocalResult: Boolean(demo.result),
    hasCompletedResult: Boolean(completed),
  });
  const active = stage === 'active';
  const cameraProps = {
    cameraStatus: demo.cameraStatus,
    detectorStatus: demo.detectorStatus,
    detectorError: demo.detectorError,
    calibrationIssue: demo.calibrationIssue,
    calibrationProgress: demo.calibrationProgress,
    calibrating: demo.phase === 'calibrating',
    profile: demo.profile,
    canCalibrate: demo.canCalibrate,
    onOpen: demo.openCamera,
    onRetryDetector: demo.retryDetector,
    onCalibrate: demo.startCalibration,
    setCameraElement: demo.setCameraElement,
  };
  const player = (
    <ChallengePanel
      hasVideo={Boolean(demo.bilibiliSelection)}
      dimension={demo.bilibiliSelection?.dimension}
      phase={demo.phase}
      canStart={demo.canStart && !starting}
      sample={demo.sample}
      countdownSeconds={demo.countdownSeconds}
      playerError={demo.playerError}
      danmakuStatus={demo.danmakuStatus}
      setPlayerContainer={demo.setPlayerContainer}
      onStart={() => void start()}
      onRetryVideo={demo.retryVideo}
    />
  );

  return (
    <main className={`page challenge-page${active ? ' is-active' : ''}`} data-stage={stage}>
      <header className="hero compact">
        <p className="eyebrow">
          {group ? '群组挑战' : opened.challenge.mode === 'self' ? '单人挑战' : opened.challenge.recipient ? `${opened.challenge.recipient}，接招吧` : '一枚绷绷炸弹'}
        </p>
        <h1>{group ? '群友们，看看谁能绷住' : opened.challenge.mode === 'self' ? '看看你能绷到第几秒' : `${opened.challenge.initiator ?? '朋友'} 挑战你`}</h1>
        <p className="intro">{opened.challenge.message || (group ? '填上昵称，完成后就能在群组结果里看到自己的记录。' : '看看你能否绷住。')}</p>
      </header>
      {!active && <StageProgress stage={stage} />}
      <div className="challenge-stage">
        {stage === 'consent' && (
          <section className="section consent">
            <VideoIntro video={opened.challenge.video} />
            <h2>开始前，请确认隐私说明</h2>
            <ul>
              <li>摄像头画面和面部变化只在你的浏览器中处理，不会上传或保存。</li>
              <li>挑战结束后只会提交结果、坚持时间和简化后的表情变化。</li>
              <li>这份结果和表情变化会在有效期结束或被删除后一起移除。</li>
              <li>不会上传摄像头照片或可识别你的面部信息。</li>
              {group
                ? <li>群组结果会显示你填写的昵称、是否绷住和坚持时间；拿到群组结果链接的人都能看到。</li>
                : <li>匿名结果会帮助大家了解这段视频的难度；删除私密结果不会影响统计。</li>}
            </ul>
            <button type="button" onClick={() => { setAccepted(true); demo.openCamera(); }}>
              我知道了，接受挑战
            </button>
          </section>
        )}
        {stage === 'calibration' && (
          <>
            <section className="stage-heading">
              <p className="step">02 · 人脸校准</p>
              <h2>保持自然表情，看向摄像头</h2>
              <p>准备好后会用约 3 秒记录你的自然表情。此时不会播放视频，也不会开始挑战。</p>
            </section>
            <CameraPanel {...cameraProps} />
          </>
        )}
        {(stage === 'ready' || stage === 'active') && (
          <>
            {stage === 'ready' && (
            <section className="stage-heading ready-heading" key="ready-heading">
                <p className="step">03 · 准备挑战</p>
                <h2>校准成功，最后确认一下</h2>
                <p>调整音量和坐姿。点击“开始挑战”后才正式计时。</p>
                <VideoIntro video={opened.challenge.video} />
                {group && attempt && !nickname && <p className="hint">恢复后会沿用本轮开始时填写的昵称。</p>}
                {group && (!attempt || nickname) && <label className="group-nickname-field">你的昵称<input className="field" maxLength={CLIENT_CONFIG.limits.nickname} value={nickname} onChange={(event) => { setNickname(event.target.value); setNicknameError(''); }} onBlur={() => rememberPreferredNickname(nickname)} placeholder="例如：小明" autoComplete="nickname" disabled={Boolean(attempt)} /><small>{attempt ? '恢复挑战会沿用本轮昵称' : `${nickname.length}/${CLIENT_CONFIG.limits.nickname}`}</small>{nicknameError && <span className="error" role="alert">{nicknameError}</span>}</label>}
              </section>
            )}
            <CameraPanel key="camera" {...cameraProps} compact={stage === 'ready'} bubble={stage === 'active'} />
            <div className="challenge-player-step" key="player">{player}</div>
            {stage === 'ready' && !demo.videoReady && !demo.playerError && (
              <p className="hint player-loading" role="status">视频准备好后就可以开始。</p>
            )}
            {stage === 'ready' && startError && <p className="error" role="alert">{startError}</p>}
            {stage === 'ready' && starting && <p className="hint" role="status">正在锁定本次挑战…</p>}
          </>
        )}
        {stage === 'invalid' && (
          <section className="section invalid-panel">
            <p className="step">挑战中止</p>
            <h2>本轮已作废</h2>
            <p>{invalidReasonText(demo.invalidReason)}</p>
            <button type="button" onClick={demo.restart}>重新准备</button>
          </section>
        )}
        {stage === 'submitting' && (
          <section className="section submitting-panel" aria-live="polite">
            <p className="step">05 · 提交结果</p>
            <h2>{submission.status === 'error' ? '结果暂时没有保存成功' : '正在保存挑战结果…'}</h2>
            <p>
              {submission.status === 'error'
                ? '结果还在当前页面，重新提交即可，不会重复计入统计。'
                : '正在保存最终结果、坚持时间和简化后的表情变化；摄像头画面不会上传。'}
            </p>
            {submission.status === 'error' && (
              <>
                <p className="error" role="alert">{submission.error}</p>
                <button type="button" onClick={() => void submitResult()}>重新提交</button>
              </>
            )}
            {submission.status !== 'error' && <div className="submit-spinner" aria-hidden="true" />}
          </section>
        )}
        {stage === 'settlement' && completed && (
          <Settlement challenge={opened.challenge} result={completed} embedded />
        )}
      </div>
    </main>
  );
}

function StageProgress({ stage }: { stage: RecipientStage }) {
  const currentStage = stage === 'invalid' ? 'active' : stage;
  const currentIndex = RECIPIENT_STEPS.findIndex((item) => item.stage === currentStage);
  return (
    <ol className="stage-progress" aria-label="挑战进度">
      {RECIPIENT_STEPS.map((item, index) => (
        <li
          key={item.stage}
          className={index === currentIndex ? 'current' : index < currentIndex ? 'done' : ''}
          aria-current={index === currentIndex ? 'step' : undefined}
        >
          <span>{index + 1}</span>{item.label}
        </li>
      ))}
    </ol>
  );
}

function VideoIntro({ video }: { video: ChallengeDisplayPayload['video'] }) {
  return (
    <div className="video-meta challenge-intro-video">
      <div className="video-cover">
        {video.cover ? <img referrerPolicy="no-referrer" src={video.cover} alt="视频封面" /> : <span>无封面</span>}
      </div>
      <div>
        <p className="video-title">{video.title}</p>
        <p className="video-subtitle">{Math.round(video.duration)} 秒视频</p>
        {video.description && <p className="muted clamp">{video.description}</p>}
      </div>
    </div>
  );
}

function Message({ title, detail }: { title: string; detail: string }) {
  return <main className="page"><section className="section"><h1>{title}</h1><p>{detail}</p></section></main>;
}
