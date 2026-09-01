import { useEffect, useRef } from 'react';
import { CopyButton } from './CopyButton';
import { detectInAppBrowser, shouldBlockInAppBrowser, type DevicePlatform, type InAppBrowserKind } from './inAppBrowser';

interface InAppBrowserNoticeProps {
  visible: boolean;
  userAgent?: string;
  /** Full challenge URL; defaults to the current browser URL. */
  url?: string;
}

export function InAppBrowserNotice({ visible, userAgent, url }: InAppBrowserNoticeProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const info = detectInAppBrowser(userAgent);
  const challengeUrl = url ?? (typeof window === 'undefined' ? '' : window.location.href);
  const blocked = shouldBlockInAppBrowser(info);

  useEffect(() => {
    if (visible && blocked) dialogRef.current?.focus();
  }, [blocked, visible]);

  if (!visible || !blocked || !info.kind) return null;

  return (
    <div className="in-app-browser-mask">
      <div
        ref={dialogRef}
        className="in-app-browser-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="in-app-browser-title"
        aria-describedby="in-app-browser-description"
        tabIndex={-1}
      >
        <p className="in-app-browser-kicker">需要使用系统浏览器</p>
        <h2 id="in-app-browser-title">请先在浏览器中打开挑战</h2>
        <p id="in-app-browser-description">
          当前正在{browserName(info.kind)}中打开，摄像头无法在这里使用。请点击右上角“···”按钮，选择“在浏览器中打开”。
        </p>
        <p className="in-app-browser-recommendation">{recommendation(info.platform)}</p>
        <CopyButton value={challengeUrl} className="secondary in-app-browser-copy" label="复制挑战网址" />
      </div>
    </div>
  );
}

function browserName(kind: InAppBrowserKind): string {
  return kind === 'wechat' ? '微信' : 'QQ';
}

function recommendation(platform: DevicePlatform): string {
  if (platform === 'android') return 'Android 推荐使用 Microsoft Edge 或 Via 浏览器。';
  if (platform === 'ios') return 'iPhone / iPad 推荐使用 Safari。';
  return '请使用系统浏览器打开。';
}
