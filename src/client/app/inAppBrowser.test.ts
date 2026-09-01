import { describe, expect, it } from 'vitest';
import { detectInAppBrowser, isCameraChallengePath } from './inAppBrowser';

describe('detectInAppBrowser', () => {
  it('recognizes WeChat on Android', () => {
    expect(detectInAppBrowser('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 MicroMessenger/8.0.50')).toEqual({ kind: 'wechat', platform: 'android' });
  });

  it('recognizes QQ and QQ Browser on mobile', () => {
    expect(detectInAppBrowser('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 QQ/8.9.0')).toEqual({ kind: 'qq', platform: 'android' });
    expect(detectInAppBrowser('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 V1_AND_SQ_8.9.50')).toEqual({ kind: 'qq', platform: 'android' });
    expect(detectInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 V1_IPH_SQ_8.9.50')).toEqual({ kind: 'qq', platform: 'ios' });
    expect(detectInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) MQQBrowser/15.0')).toEqual({ kind: 'qq', platform: 'ios' });
  });

  it('recognizes iPad desktop-mode user agents', () => {
    expect(detectInAppBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.50')).toEqual({ kind: 'wechat', platform: 'ios' });
  });

  it('does not flag regular browsers', () => {
    expect(detectInAppBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0')).toEqual({ kind: null, platform: 'other' });
    expect(detectInAppBrowser('')).toEqual({ kind: null, platform: 'other' });
  });
});

describe('isCameraChallengePath', () => {
  it('matches single and group challenge routes only', () => {
    expect(isCameraChallengePath('/c/bc1.token')).toBe(true);
    expect(isCameraChallengePath('/g/bg1.token')).toBe(true);
    expect(isCameraChallengePath('/g/entry/bge1.token')).toBe(false);
    expect(isCameraChallengePath('/g/results/bgr1.token')).toBe(false);
    expect(isCameraChallengePath('/report/br1.token')).toBe(false);
  });
});
