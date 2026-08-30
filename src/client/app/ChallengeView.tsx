import { useCallback, useEffect, useRef, useState } from 'react';
import { post } from '../api/client';
import { decodeScoreTrace, isRecord, type AggregateStats, type ChallengePayload, type PlaybackData, type ScorePoint } from '../../shared/contracts';
import { useSmileDemo } from '../gameplay/app/useSmileDemo';
import { CameraPanel } from '../gameplay/app/CameraPanel';
import { ChallengePanel } from '../gameplay/app/ChallengePanel';
import { invalidReasonText } from '../gameplay/app/viewText';
import { Settlement } from './Settlement';
import { RECIPIENT_STEPS, recipientStage, type RecipientStage } from './recipientFlow';

interface Opened {
  challenge: ChallengePayload;
  playback: PlaybackData;
  stats: AggregateStats;
  session: { state: 'opened' | 'started' | 'completed'; result_expires_at?: number | null } | null;
}

interface Completed {
  outcome: 'held' | 'failed';
  elapsedSeconds: number;
  reportUrl: string;
  stats: AggregateStats;
  scoreTrace?: ReadonlyArray<Readonly<ScorePoint>>;
}

type Submission = { status: 'idle' | 'submitting' | 'error'; error: string };

const attemptKey = (token: string) => `bengbeng-attempt:${token}`;
const completedKey = (token: string) => `bengbeng-completed:${token}`;

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function readCachedCompleted(token: string, durationSeconds: number): Completed | null {
  const key = completedKey(token);
  const raw = sessionStorage.getItem(key);
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
    sessionStorage.removeItem(key);
    return null;
  }
}

const clearCachedCompleted = (token: string) => sessionStorage.removeItem(completedKey(token));

export function ChallengeView({ token }: { token: string }) {
  const demo = useSmileDemo();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [attempt, setAttempt] = useState(() => sessionStorage.getItem(attemptKey(token)) || '');
  const [completed, setCompleted] = useState<Completed | null>(null);
  const [openError, setOpenError] = useState('');
  const [startError, setStartError] = useState('');
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
    void post<Opened>('/api/challenges/open', { challengeToken: token })
      .then((value) => {
        if (value.session?.state === 'completed') {
          const expiresAt = value.session.result_expires_at;
          const resultIsCurrent = expiresAt === undefined || (typeof expiresAt === 'number' && expiresAt > Math.floor(Date.now() / 1000));
          const cached = resultIsCurrent ? readCachedCompleted(token, value.challenge.video.duration) : null;
          if (cached) setCompleted(cached);
          else clearCachedCompleted(token);
        } else {
          clearCachedCompleted(token);
        }
        setOpened(value);
        demo.selectResolvedBilibili(value.playback);
      })
      .catch((error) => setOpenError(error instanceof Error ? error.message : '挑战加载失败'));
  }, [demo, token]);

  const submitResult = useCallback(async () => {
    if (!localResult || !attempt || submitting.current) return;
    submitting.current = true;
    closeCamera();
    setSubmission({ status: 'submitting', error: '' });
    try {
      const value = await post<Completed>('/api/challenges/complete', {
        challengeToken: token,
        attemptToken: attempt,
        outcome: localResult.outcome === 'completed' ? 'held' : 'failed',
        elapsedSeconds: localResult.videoPositionSeconds,
        scoreTrace: localResult.scoreTrace,
      });
      sessionStorage.removeItem(attemptKey(token));
      const completedValue = { ...value, scoreTrace: localResult.scoreTrace };
      setCompleted(completedValue);
      try { sessionStorage.setItem(completedKey(token), JSON.stringify(completedValue)); } catch { /* private storage can be unavailable */ }
      setSubmission({ status: 'idle', error: '' });
      void document.exitFullscreen?.().catch(() => undefined);
    } catch (error) {
      submitting.current = false;
      setSubmission({
        status: 'error',
        error: error instanceof Error ? error.message : '结果提交失败',
      });
    }
  }, [attempt, closeCamera, localResult, token]);

  useEffect(() => {
    if (localResult) void submitResult();
  }, [localResult, submitResult]);

  const start = async () => {
    if (!demo.canStart || starting) return;
    setStarting(true);
    setStartError('');
    try {
      let currentAttempt = attempt;
      if (!currentAttempt) {
        const value = await post<{ attemptToken: string }>('/api/challenges/start', {
          challengeToken: token,
        });
        currentAttempt = value.attemptToken;
        sessionStorage.setItem(attemptKey(token), currentAttempt);
        setAttempt(currentAttempt);
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
  if (!opened) return <Message title="正在拆弹…" detail="正在验证挑战并刷新视频直链" />;
  if (opened.session?.state === 'completed' && !completed) {
    return <Message title="这枚炸弹已经引爆过了" detail="每个挑战只记录一次结果，请让发起者查看私密结果入口。" />;
  }
  if (opened.session?.state === 'started' && !attempt) {
    return <Message title="挑战已经开始" detail="一次性挑战不能由另一个会话重新接管。" />;
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
    />
  );

  return (
    <main className={`page challenge-page${active ? ' is-active' : ''}`} data-stage={stage}>
      <header className="hero compact">
        <p className="eyebrow">
          {opened.challenge.mode === 'self' ? '单人挑战' : opened.challenge.recipient ? `${opened.challenge.recipient}，接招吧` : '一枚绷绷炸弹'}
        </p>
        <h1>{opened.challenge.mode === 'self' ? '看看你能绷到第几秒' : `${opened.challenge.initiator ?? '朋友'} 挑战你`}</h1>
        <p className="intro">{opened.challenge.message || '看完整段视频，全程不许笑。'}</p>
      </header>
      {!active && <StageProgress stage={stage} />}
      <div className="challenge-stage">
        {stage === 'consent' && (
          <section className="section consent">
            <VideoIntro video={opened.challenge.video} />
            <h2>开始前，请确认隐私说明</h2>
            <ul>
              <li>摄像头画面和人脸特征只在你的浏览器中检测，不上传、不保存。</li>
              <li>只上传最终结果、坚持秒数，以及每秒最多一个的 0–100 表情程度值。</li>
              <li>量化曲线与挑战结果使用相同保留时间，结果过期或主动销毁时同步删除。</li>
              <li>不上传摄像头图像、人脸特征、landmarks 或逐帧原始检测数据。</li>
              <li>脱敏后的结果会计入这条视频的匿名统计，销毁私人结果后仍会保留。</li>
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
              <p>模型准备好后进行约 3 秒校准。此时不会播放挑战视频，也不会消耗挑战资格。</p>
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
                <p>调整音量和坐姿。只有点击“开始挑战”后，才会占用这次挑战资格。</p>
                <VideoIntro video={opened.challenge.video} />
              </section>
            )}
            <CameraPanel key="camera" {...cameraProps} compact={stage === 'ready'} bubble={stage === 'active'} />
            <div className="challenge-player-step" key="player">{player}</div>
            {stage === 'ready' && !demo.videoReady && !demo.playerError && (
              <p className="hint player-loading" role="status">正在准备视频，按钮会在画面就绪后开放…</p>
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
            <h2>{submission.status === 'error' ? '结果暂时没有提交成功' : '正在封存挑战结果…'}</h2>
            <p>
              {submission.status === 'error'
                ? '本地结果仍保留在当前页面，可以安全重试，不会重复计算匿名统计。'
                : '正在提交最终结果、坚持秒数和降采样表情曲线；摄像头图像和人脸特征仍只留在本机。'}
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

function VideoIntro({ video }: { video: ChallengePayload['video'] }) {
  return (
    <div className="video-meta challenge-intro-video">
      <div className="video-cover">
        {video.cover ? <img referrerPolicy="no-referrer" src={video.cover} alt="视频封面" /> : <span>无封面</span>}
      </div>
      <div>
        <p className="video-title">{video.title}</p>
        <p className="video-subtitle">{Math.round(video.duration)} 秒 · {video.bvid}</p>
        {video.description && <p className="muted clamp">{video.description}</p>}
      </div>
    </div>
  );
}

function Message({ title, detail }: { title: string; detail: string }) {
  return <main className="page"><section className="section"><h1>{title}</h1><p>{detail}</p><a href="/">返回首页</a></section></main>;
}
