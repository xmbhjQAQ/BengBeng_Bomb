import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyChallengesView } from './MyChallengesView';

const mocks = vi.hoisted(() => ({
  records: [] as Array<Record<string, unknown>>,
  remove: vi.fn(),
  clear: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
}));

vi.mock('../storage/createdChallenges', () => ({
  readCreatedChallenges: () => mocks.records,
  removeCreatedChallenge: mocks.remove,
  clearCreatedChallenges: mocks.clear,
  subscribeCreatedChallenges: mocks.subscribe,
}));

const classic = {
  id: 'classic:one',
  kind: 'classic',
  video: { source: 'bilibili', bvid: 'BV1B7411m7LV', cid: 1, page: 1, title: '单人测试视频', description: '', cover: '', duration: 60 },
  createdAt: 1_800_000_000,
  expiresAt: 1_800_003_600,
  challengeUrl: `${location.origin}/c/public-token`,
  manageUrl: `${location.origin}/manage#m=private-token&c=public-token`,
  initiator: '小明',
};

const group = {
  ...classic,
  id: 'group:one',
  kind: 'group',
  video: { ...classic.video, title: '群组测试视频' },
  challengeUrl: `${location.origin}/g/direct-token`,
  entryUrl: `${location.origin}/g/entry/group-entry-token`,
  resultUrl: `${location.origin}/g/results/group-result-token`,
  manageUrl: `${location.origin}/manage#m=group-private-token`,
};

describe('MyChallengesView', () => {
  beforeEach(() => {
    mocks.records = [];
    mocks.remove.mockReset();
    mocks.clear.mockReset();
    mocks.subscribe.mockClear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('explains browser-only storage when there are no records', () => {
    render(<MyChallengesView navigate={vi.fn()} />);
    expect(screen.getByText('还没有本机记录')).toBeVisible();
    expect(screen.getByText(/换设备或清除浏览器数据后无法找回/)).toBeVisible();
  });

  it('opens stored routes without exposing capability URLs as visible text', () => {
    mocks.records = [classic, group];
    const navigate = vi.fn();
    render(<MyChallengesView navigate={navigate} />);

    expect(screen.getByText('单人测试视频')).toBeVisible();
    expect(screen.getByText('群组测试视频')).toBeVisible();
    expect(screen.queryByText(classic.manageUrl)).not.toBeInTheDocument();
    expect(screen.queryByText(group.resultUrl)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看状态与结果' }));
    expect(navigate).toHaveBeenCalledWith('/manage#m=private-token&c=public-token');
    fireEvent.click(screen.getByRole('button', { name: '查看大家的结果' }));
    expect(navigate).toHaveBeenCalledWith('/g/results/group-result-token');
  });

  it('requires confirmation before removing one or all records', () => {
    mocks.records = [classic];
    render(<MyChallengesView navigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '移除记录' }));
    expect(mocks.remove).toHaveBeenCalledWith(classic.id);
    fireEvent.click(screen.getByRole('button', { name: '清空记录' }));
    expect(mocks.clear).toHaveBeenCalledTimes(1);
  });
});
