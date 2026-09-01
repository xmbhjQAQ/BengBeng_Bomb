import { useCallback, useEffect, useRef, useState } from 'react';
import { post } from '../api/client';
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

export function ChallengeView({ token, group = false }: { token: string; group?: boolean }) {
  const demo = useSmileDemo();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [attempt, setAttempt] = useState(() => readSession(attemptKey(token, group)) || '');
  const [groupAttemptId, setGroupAttemptId] = useState(() => group ? readSession(groupAttemptIdKey(token)) || '' : '');
  const [completed, setCompleted] = useState<Completed | null>(null);
  const [openError, setOpenError] = useState('');
  const [startError, setStartError] = useState('');
  const [nickname, setNickname] = useState('');
  const [nicknameError, setNicknameError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [submission, setSubmission] = useState<Submission>({ status: 'idle', error: '' });
  const loaded = useRef(false);
  const submitting = useRef(false);
  const localResult = demo.result;
  const closeCamera = demo.closeCamera;

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void post<unknown>(group ? '/api/groups/open' : '/api/challenges/open', group ? { groupToken: token } : { challengeToken: token })
      .then((raw) => {
        const value = group ? normalizeGroupOpen(raw) : raw as Opened;
        if (value.session?.state === 'completed') {
          const expiresAt = value.session.result_expires_at;
          const resultIsCurrent = expiresAt === undefined || (typeof expiresAt === 'number' && expiresAt > Math.floor(Date.now() / 1000));
          const cached = !group && resultIsCurrent ? readCachedCompleted(token, value.challenge.video.duration) : null;
          if (cached) setCompleted(cached);
          else if (!group) clearCachedCompleted(token);
        } else {
          if (!group) clearCachedCompleted(token);
        }
        setOpened(value);
        demo.selectResolvedBilibili(value.playback);
      })
      .catch((error) => setOpenError(error instanceof Error ? error.message : '挑战加载失败'));
  }, [demo, group, token]);

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
      removeSession(attemptKey(token, group));
      if (group) removeSession(groupAttemptIdKey(token));
      const completedValue = value;
      setCompleted(completedValue);
      if (!group) {
        writeSession(completedKey(token), JSON.stringify(completedValue));
      }
      setSubmission({ status: 'idle', error: '' });
      void document.exitFullscreen?.().catch(() => undefined);
    } catch (error) {
      submitting.current = false;
      setSubmission({
        status: 'error',
        error: error instanceof Error ? error.message : '结果提交失败',
      });
    }
  }, [attempt, closeCamera, group, groupAttemptId, localResult, token]);

  useEffect(() => {
    if (localResult) void submitResult();
  }, [localResult, submitResult]);

  const start = async () => {
    if (!demo.canStart || starting) return;
    if (group && !nickname.trim()) {
      setNicknameError('请先填写昵称，再开始挑战。');
      return;
    }
    setStarting(true);
    setStartError('');
    setNicknameError('');
    try {
      let currentAttempt = attempt;
      if (!currentAttempt) {
        const value = await post<{ attemptToken: string; attemptId?: string }>(group ? '/api/groups/start' : '/api/challenges/start', group
          ? { groupToken: token, nickname: nickname.trim() }
          : { challengeToken: token });
        currentAttempt = value.attemptToken;
        writeSession(attemptKey(token, group), currentAttempt);
        setAttempt(currentAttempt);
        if (group && value.attemptId) {
          writeSession(groupAttemptIdKey(token), value.attemptId);
          setGroupAttemptId(value.attemptId);
        }
      }
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
  if (opened.session?.state === 'completed' && !completed) {
    return <Message title="这枚炸弹已经引爆过了" detail="这次挑战已经完成，每个挑战只能记录一次结果。请回到发起者保存的结果入口查看详情。" />;
  }
  if (opened.session?.state === 'started' && !attempt) {
    return <Message title="挑战已经开始" detail="这次挑战已经在别处开始，请从原来的页面继续。" />;
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
                {group && <label className="group-nickname-field">你的昵称<input className="field" maxLength={CLIENT_CONFIG.limits.nickname} value={nickname} onChange={(event) => { setNickname(event.target.value); setNicknameError(''); }} placeholder="例如：小明" autoComplete="nickname" /><small>{nickname.length}/{CLIENT_CONFIG.limits.nickname}</small>{nicknameError && <span className="error" role="alert">{nicknameError}</span>}</label>}
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
