import type { ChallengePhase } from '../challenge';
import { formatNumber, t } from '../i18n';
import type { SmileSample } from '../scoring';
import { DanmakuNotice } from './BilibiliSourcePanel';
import type { BilibiliVideoDimension } from '../bilibili';

interface ChallengePanelProps {
  hasVideo: boolean;
  dimension?: BilibiliVideoDimension;
  phase: ChallengePhase;
  canStart: boolean;
  sample: SmileSample | null;
  countdownSeconds: number | null;
  playerError: string | null;
  danmakuStatus: 'unavailable' | 'loading' | 'ready' | 'error';
  setPlayerContainer(element: HTMLDivElement | null): void;
  onStart(): void;
}

const activePhases: ChallengePhase[] = [
  'running',
  'face-grace',
  'face-paused',
  'resume-stabilizing',
  'resume-countdown',
  'buffering',
];

const challengeStatus = (
  phase: ChallengePhase,
  sample: SmileSample | null,
  countdown: number | null,
) => {
  if (phase === 'running') return sample?.classification === 'danger' ? t.challenge.danger : t.challenge.neutral;
  if (phase === 'face-grace') return t.challenge.faceGrace;
  if (phase === 'face-paused') return t.challenge.facePaused;
  if (phase === 'resume-stabilizing') return t.challenge.stabilizing;
  if (phase === 'resume-countdown') {
    return `${formatNumber(countdown ?? 1, 0)}，${t.challenge.countdown}`;
  }
  if (phase === 'buffering') return t.challenge.buffering;
  if (phase === 'invalid') return t.challenge.invalid;
  return phase === 'ready' ? t.challenge.ready : t.challenge.selectVideo;
};

export function ChallengePanel(props: ChallengePanelProps) {
  const active = activePhases.includes(props.phase);
  const rotated = props.dimension?.rotate === 90 || props.dimension?.rotate === 270;
  const width = rotated ? props.dimension?.height ?? 16 : props.dimension?.width ?? 16;
  const height = rotated ? props.dimension?.width ?? 9 : props.dimension?.height ?? 9;
  const ratio = width > 0 && height > 0 ? width / height : 16 / 9;
  const portrait = ratio < 1;
  return (
    <section className="section challenge-section">
      <h2>{t.challenge.title}</h2>
      <div
        className={`player-shell${active ? ' player-active' : ' player-locked'}${portrait ? ' portrait-player' : ''}`}
        aria-disabled={!active}
        inert={!active}
      >
        <div
          ref={props.setPlayerContainer}
          className="artplayer-host"
          style={{ aspectRatio: `${width} / ${height}` }}
          aria-label={t.challenge.title}
        />
        {!props.hasVideo && <p className="player-empty">{t.challenge.noVideo}</p>}
      </div>
      <DanmakuNotice status={props.danmakuStatus} />
      {props.playerError && <p className="error" role="alert">{props.playerError}</p>}
      <div className="challenge-actions">
        <button type="button" onClick={props.onStart} disabled={!props.canStart}>
          {t.challenge.start}
        </button>
        <p className={`challenge-status status-${props.phase}`} role="status">{challengeStatus(props.phase, props.sample, props.countdownSeconds)}</p>
      </div>
    </section>
  );
}
