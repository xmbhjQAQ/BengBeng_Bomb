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
    expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/');
  });
});
