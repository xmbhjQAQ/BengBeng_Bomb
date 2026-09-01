import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

vi.mock('./HomeView',()=>({HomeView:({navigate}:{navigate(path:string):void})=><button onClick={()=>navigate('/c/self-token')}>open-self</button>}));
vi.mock('./ChallengeView',()=>({ChallengeView:({token}:{token:string})=><div>challenge:{token}</div>}));
vi.mock('./ReportView',()=>({ReportView:()=>null}));
vi.mock('./ManageView',()=>({ManageView:()=>null}));

describe('App SPA navigation',()=>{
  afterEach(()=>{cleanup();history.replaceState({},'', '/');});
  it('pushes a self challenge without document reload and reacts to browser back/popstate',()=>{
    history.replaceState({},'', '/');
    const push=vi.spyOn(history,'pushState');
    render(<App/>);
    expect(screen.getByRole('link', { name: 'xmbhjQAQ' })).toHaveAttribute('href', 'https://space.bilibili.com/174355920');
    expect(screen.getByRole('link', { name: 'Github' })).toHaveAttribute('href', 'https://github.com/xmbhjQAQ?tab=repositories');
    fireEvent.click(screen.getByRole('button',{name:'open-self'}));
    expect(push).toHaveBeenCalledWith({},'', '/c/self-token');
    expect(screen.getByText('challenge:self-token')).toBeVisible();
    history.replaceState({},'', '/');
    fireEvent.popState(window);
    expect(screen.getByRole('button',{name:'open-self'})).toBeVisible();
  });
  it('shows a recovery page for a malformed encoded token instead of throwing',()=>{
    history.replaceState({},'', '/c/%E0%A4%A');
    render(<App/>);
    expect(screen.getByRole('heading', { name: '链接无法打开' })).toBeVisible();
    expect(screen.getByRole('link', { name: '回到首页' })).toHaveAttribute('href', '/');
  });
  it('shows a shared home control on non-challenge routes and navigates in place',()=>{
    history.replaceState({},'', '/report/public-token');
    const pushState=vi.spyOn(history,'pushState');
    render(<App/>);
    fireEvent.click(screen.getByRole('link', { name: '回到首页' }));
    expect(pushState).toHaveBeenCalledWith({},'', '/');
    expect(window.location.pathname).toBe('/');
  });
  it('does not add a home control to a valid challenge route',()=>{
    history.replaceState({},'', '/c/self-token');
    render(<App/>);
    expect(screen.queryByRole('link', { name: '回到首页' })).not.toBeInTheDocument();
  });
  it('blocks only challenge routes for QQ or WeChat browsers',()=>{
    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Linux; Android 14) MicroMessenger/8.0.50' });
    try {
      history.replaceState({},'', '/c/self-token');
      const view = render(<App/>);
      expect(screen.getByRole('alertdialog')).toBeVisible();
      history.replaceState({},'', '/report/public-token');
      fireEvent.popState(window);
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: '回到首页' })).toBeVisible();
      view.unmount();
    } finally {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalUserAgent });
    }
  });
  it('does not block an iOS QQ or WeChat challenge route',()=>{
    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 MicroMessenger/8.0.50' });
    try {
      history.replaceState({},'', '/c/ios-token');
      render(<App/>);
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.getByText('challenge:ios-token')).toBeVisible();
      expect(screen.getByText('challenge:ios-token').closest('.app-view')).not.toHaveAttribute('aria-hidden', 'true');
    } finally {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalUserAgent });
    }
  });
});
