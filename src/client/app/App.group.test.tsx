import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

vi.mock('./HomeView', () => ({ HomeView: () => <div>home</div> }));
vi.mock('./ChallengeView', () => ({ ChallengeView: ({ token, group }: { token: string; group?: boolean }) => <div>{group ? `group:${token}` : `single:${token}`}</div> }));
vi.mock('./GroupResultsView', () => ({ GroupResultsView: ({ token }: { token: string }) => <div>results:{token}</div> }));
vi.mock('./GroupEntryView', () => ({ GroupEntryView: ({ token }: { token: string }) => <div>entry:{token}</div> }));
vi.mock('./ReportView', () => ({ ReportView: () => null }));
vi.mock('./ManageView', () => ({ ManageView: () => null }));

describe('group SPA routes', () => {
  afterEach(() => {
    cleanup();
    history.replaceState({}, '', '/');
  });

  it('projects group invitation and result URLs without a document reload', () => {
    history.replaceState({}, '', '/g/bg1.invitation-token');
    render(<App />);
    expect(screen.getByText('group:bg1.invitation-token')).toBeVisible();

    history.replaceState({}, '', '/g/results/bgr1.result-token');
    fireEvent.popState(window);
    expect(screen.getByText('results:bgr1.result-token')).toBeVisible();
  });

  it('projects the universal group entry URL without a document reload', () => {
    history.replaceState({}, '', '/g/entry/bge1.entry-token');
    render(<App />);
    expect(screen.getByText('entry:bge1.entry-token')).toBeVisible();
  });

  it('does not confuse single challenge or management paths with group routes', () => {
    history.replaceState({}, '', '/c/bc1.challenge-token');
    const view = render(<App />);
    expect(screen.getByText('single:bc1.challenge-token')).toBeVisible();
    history.replaceState({}, '', '/manage');
    fireEvent.popState(window);
    expect(screen.queryByText(/group:|results:/)).not.toBeInTheDocument();
    view.unmount();
  });
});
