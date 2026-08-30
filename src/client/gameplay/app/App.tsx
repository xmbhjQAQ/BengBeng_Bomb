import { ResultPanel } from '../result';
import { t } from '../i18n';
import { BilibiliSourcePanel } from './BilibiliSourcePanel';
import { CameraPanel } from './CameraPanel';
import { ChallengePanel } from './ChallengePanel';
import { MetricsPanel } from './MetricsPanel';
import { useSmileDemo } from './useSmileDemo';
import { invalidReasonText } from './viewText';

export function App() {
  const demo = useSmileDemo();
  const locked = [
    'running',
    'face-grace',
    'face-paused',
    'resume-stabilizing',
    'resume-countdown',
    'buffering',
  ].includes(demo.phase);

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">CORE GAMEPLAY TEST</p>
        <h1>{t.app.title}</h1>
        <p className="intro">{t.app.intro}</p>
        <p className="privacy-note">{t.app.privacy}</p>
      </header>

      <BilibiliSourcePanel
        selection={demo.bilibiliSelection}
        loading={demo.sourceLoading}
        error={demo.sourceError}
        disabled={locked}
        onSubmit={demo.selectBilibili}
      />
      <CameraPanel
        cameraStatus={demo.cameraStatus}
        detectorStatus={demo.detectorStatus}
        detectorError={demo.detectorError}
        calibrationIssue={demo.calibrationIssue}
        calibrationProgress={demo.calibrationProgress}
        calibrating={demo.phase === 'calibrating'}
        profile={demo.profile}
        canCalibrate={demo.canCalibrate}
        onOpen={demo.openCamera}
        onRetryDetector={demo.retryDetector}
        onCalibrate={demo.startCalibration}
        setCameraElement={demo.setCameraElement}
      />
      <ChallengePanel
        hasVideo={Boolean(demo.bilibiliSelection)}
        dimension={demo.bilibiliSelection?.dimension}
        phase={demo.phase}
        canStart={demo.canStart}
        sample={demo.sample}
        countdownSeconds={demo.countdownSeconds}
        playerError={demo.playerError}
        danmakuStatus={demo.danmakuStatus}
        setPlayerContainer={demo.setPlayerContainer}
        onStart={demo.startChallenge}
      />
      <MetricsPanel phase={demo.phase} metrics={demo.metrics} />

      {demo.phase === 'invalid' && (
        <section className="section invalid-panel" role="alert">
          <p>{t.challenge.invalid}</p>
          <p>{invalidReasonText(demo.invalidReason)}</p>
          <button type="button" onClick={demo.restart}>{t.result.restart}</button>
        </section>
      )}
      {demo.result && <ResultPanel result={demo.result} onRestart={demo.restart} />}
    </main>
  );
}
