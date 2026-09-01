export type InAppBrowserKind = 'wechat' | 'qq';
export type DevicePlatform = 'android' | 'ios' | 'other';

export interface InAppBrowserInfo {
  kind: InAppBrowserKind | null;
  platform: DevicePlatform;
}

/**
 * Detect the embedded browsers that cannot reliably provide camera access.
 * Keeping the classifier pure lets the UI be tested without mutating the
 * process-wide navigator in a jsdom environment.
 */
export function detectInAppBrowser(userAgent = getDefaultUserAgent()): InAppBrowserInfo {
  const ua = userAgent.toLowerCase();
  const kind: InAppBrowserKind | null = /micromessenger/.test(ua)
    ? 'wechat'
    : /(?:mqqbrowser|qqbrowser|qq\/|v1_(?:and|iph)_sq)/.test(ua)
      ? 'qq'
      : null;

  return {
    kind,
    platform: /android/.test(ua)
      ? 'android'
      : /iphone|ipad|ipod/.test(ua) || (/macintosh/.test(ua) && /mobile/.test(ua))
        ? 'ios'
        : 'other',
  };
}

export function isCameraChallengePath(pathname: string): boolean {
  return /^\/c\/[^/]+$/.test(pathname) || /^\/g\/[^/]+$/.test(pathname);
}

function getDefaultUserAgent(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent;
}
