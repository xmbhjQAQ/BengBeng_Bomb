import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InAppBrowserNotice } from './InAppBrowserNotice';

describe('InAppBrowserNotice', () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, 'clipboard');
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('blocks a WeChat Android challenge with browser instructions', () => {
    render(<InAppBrowserNotice visible userAgent="Mozilla/5.0 (Linux; Android 14) MicroMessenger/8.0.50" />);
    expect(screen.getByRole('alertdialog', { name: '请先在浏览器中打开挑战' })).toBeVisible();
    expect(screen.getByText(/点击右上角/)).toBeVisible();
    expect(screen.getByText(/Microsoft Edge 或 Via/)).toBeVisible();
    expect(screen.getByRole('button', { name: '复制挑战网址' })).toBeVisible();
  });

  it('does not block an iOS QQ or WeChat challenge', () => {
    const qq = render(<InAppBrowserNotice visible userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) QQ/8.9.0" />);
    expect(qq.container).toBeEmptyDOMElement();
    qq.unmount();

    const wechat = render(<InAppBrowserNotice visible userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) MicroMessenger/8.0.50" />);
    expect(wechat.container).toBeEmptyDOMElement();
  });

  it('copies the injected complete challenge URL and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(
      <InAppBrowserNotice
        visible
        url="https://bomb.example/c/challenge-token"
        userAgent="Mozilla/5.0 (Linux; Android 14) MicroMessenger/8.0.50"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '复制挑战网址' }));

    expect(await screen.findByRole('button', { name: '已复制' })).toBeVisible();
    expect(writeText).toHaveBeenCalledWith('https://bomb.example/c/challenge-token');
  });

  it('renders nothing when hidden or when the browser is regular', () => {
    const view = render(<InAppBrowserNotice visible={false} userAgent="Mozilla/5.0 Chrome/139.0 Edg/139.0" />);
    expect(view.container).toBeEmptyDOMElement();
  });
});
