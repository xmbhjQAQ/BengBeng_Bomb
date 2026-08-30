import type { CalibrationProfile } from '../calibration';
import type { CameraStatus } from '../camera';
import type { DetectorStatus } from '../detector';
import { t } from '../i18n';
import { cameraStatusText, detectorStatusText } from './viewText';

interface CameraPanelProps {
  bubble?: boolean;
  compact?: boolean;
  cameraStatus: CameraStatus;
  detectorStatus: DetectorStatus;
  calibrationIssue: CalibrationProfile['quality'] | null;
  calibrationProgress: number;
  calibrating: boolean;
  profile: CalibrationProfile | null;
  canCalibrate: boolean;
  onOpen(): void;
  onRetryDetector(): void;
  onCalibrate(): void;
  setCameraElement(element: HTMLVideoElement | null): void;
}

export function CameraPanel(props: CameraPanelProps) {
  const cameraFailed = ['denied', 'insecure-context', 'unavailable', 'interrupted', 'unsupported']
    .includes(props.cameraStatus);
  const issueText = props.calibrationIssue === 'insufficient'
    ? t.camera.calibrationInsufficient
    : props.calibrationIssue === 'unstable'
      ? t.camera.calibrationUnstable
      : null;

  return (
    <section className={`section camera-section${props.bubble ? ' camera-bubble' : ''}${props.compact ? ' camera-compact' : ''}`}>
      <h2>{props.compact ? '摄像头已就绪' : t.camera.title}</h2>
      <div className="camera-layout">
        <video
          ref={props.setCameraElement}
          className="camera-preview"
          muted
          playsInline
          autoPlay
          aria-label={t.camera.title}
        />
        <div className="camera-actions">
          <p role="status">{cameraStatusText(props.cameraStatus)}</p>
          <p className={props.detectorStatus === 'error' ? 'error' : ''}>
            {detectorStatusText(props.detectorStatus)}
          </p>
          {(props.cameraStatus === 'idle' || cameraFailed) && (
            <button type="button" onClick={props.onOpen} disabled={props.cameraStatus === 'requesting'}>
              {cameraFailed ? t.camera.retry : t.camera.open}
            </button>
          )}
          {props.detectorStatus === 'error' && (
            <button type="button" className="secondary" onClick={props.onRetryDetector}>
              {t.camera.retryModel}
            </button>
          )}
          {!props.compact && <button type="button" onClick={props.onCalibrate} disabled={!props.canCalibrate}>
            {props.profile ? t.camera.recalibrate : t.camera.calibrate}
          </button>}
          {props.calibrating && (
            <div className="calibration-progress">
              <progress max={1} value={props.calibrationProgress} />
            </div>
          )}
          {!props.compact && <p className={props.profile?.quality === 'good' ? 'success' : ''} role="status">
            {props.calibrating
              ? t.camera.calibrating
              : props.profile?.quality === 'good'
                ? t.camera.calibrationGood
                : t.camera.calibrationWaiting}
          </p>}
          {!props.compact && issueText && <p className="error" role="alert">{issueText}</p>}
        </div>
      </div>
    </section>
  );
}
