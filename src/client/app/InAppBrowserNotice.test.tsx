import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InAppBrowserNotice } from './InAppBrowserNotice';

describe('InAppBrowserNotice', () => {
  it('blocks a WeChat Android challenge with browser instructions', () => {
    render(<InAppBrowserNotice visible userAgent="Mozilla/5.0 (Linux; Android 14) MicroMessenger/8.0.50" />);
    expect(screen.getByRole('alertdialog', { name: '请先在浏览器中打开挑战' })).toBeVisible();
    expect(screen.getByText(/点击右上角/)).toBeVisible();
    expect(screen.getByText(/Microsoft Edge 或 Via/)).toBeVisible();
  });

  it('recommends Safari for an iOS QQ browser', () => {
    render(<InAppBrowserNotice visible userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) QQ/8.9.0" />);
    expect(screen.getByText(/iPhone \/ iPad 推荐使用 Safari/)).toBeVisible();
  });

  it('renders nothing when hidden or when the browser is regular', () => {
    const view = render(<InAppBrowserNotice visible={false} userAgent="Mozilla/5.0 Chrome/139.0 Edg/139.0" />);
    expect(view.container).toBeEmptyDOMElement();
  });
});
