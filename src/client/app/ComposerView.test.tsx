import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposerView } from './ComposerView';
import { readPreferredNickname, rememberPreferredNickname } from '../storage/preferredNickname';
import { readCreatedChallenges } from '../storage/createdChallenges';

const mocks = vi.hoisted(() => ({ post: vi.fn(), createShareCard: vi.fn(), downloadBlob: vi.fn() }));
vi.mock('../api/client', () => ({ post: mocks.post }));
vi.mock('../sharing/card', () => ({ createShareCard: mocks.createShareCard, downloadBlob: mocks.downloadBlob }));

const parsed = {
  video: {
    source: 'bilibili' as const,
    bvid: 'BV1B7411m7LV',
    cid: 1,
    page: 1,
    title: '测试视频',
    description: '',
    cover: '',
    duration: 60,
    media: ['https://cdn.example/video.mp4'],
  },
  videoTicket: 'ticket',
};

describe('ComposerView links', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    mocks.post.mockReset();
    mocks.createShareCard.mockReset();
    mocks.createShareCard.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('prefills and updates the shared preferred nickname', async () => {
    rememberPreferredNickname('上次昵称');
    mocks.post.mockResolvedValueOnce(parsed).mockResolvedValueOnce({
      challengeUrl: 'https://example.com/c/nickname-test',
      manageUrl: 'https://example.com/manage#m=nickname-private',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    render(<ComposerView />);
    fireEvent.change(screen.getByLabelText('B站视频链接'), { target: { value: 'BV1B7411m7LV' } });
    fireEvent.click(screen.getByRole('button', { name: '解析视频' }));
    await screen.findByText('测试视频');
    const nickname = screen.getAllByRole('textbox')[1]!;
    expect(nickname).toHaveValue('上次昵称');
    fireEvent.change(nickname, { target: { value: '新的昵称' } });
    fireEvent.blur(nickname);
    fireEvent.click(screen.getByRole('button', { name: '生成挑战' }));
    await screen.findByText('挑战已装好');
    expect(readPreferredNickname()).toBe('新的昵称');
    expect(readCreatedChallenges()).toEqual([expect.objectContaining({ kind: 'classic', initiator: '新的昵称', challengeUrl: 'https://example.com/c/nickname-test' })]);
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, 'clipboard');
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'canShare');
  });

  it('shows compact capability previews while copying the complete values', async () => {
    const created = {
      challengeUrl: 'https://example.com/c/bc1-this-is-a-long-token-1234',
      manageUrl: 'https://example.com/manage#bm1-this-is-a-long-private-token-5678',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
    mocks.post.mockResolvedValueOnce(parsed).mockResolvedValueOnce(created);

    render(<ComposerView />);
    fireEvent.change(screen.getByLabelText('B站视频链接'), { target: { value: 'BV1B7411m7LV' } });
    fireEvent.click(screen.getByRole('button', { name: '解析视频' }));
    await screen.findByText('测试视频');
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: '发起者' } });
    fireEvent.click(screen.getByRole('button', { name: '生成挑战' }));

    expect(await screen.findByText('https://example.com/c/…1234')).toBeVisible();
    expect(screen.getByText('https://example.com/manage#••••')).toBeVisible();
    expect(screen.queryByText(created.challengeUrl)).not.toBeInTheDocument();
    expect(screen.queryByText(created.manageUrl)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: '复制链接' })[0]!);
    expect(await screen.findByRole('button', { name: '已复制' })).toBeVisible();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(created.challengeUrl);
  });

  it('uses the universal entry URL as the single group share link', async () => {
    const created = {
      invitationUrl: 'https://example.com/g/bg1-direct-token',
      entryUrl: 'https://example.com/g/entry/bge1-universal-token',
      resultUrl: 'https://example.com/g/results/bgr1-result-token',
      manageUrl: 'https://example.com/manage#bm1-private-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      resultExpiresAt: Math.floor(Date.now() / 1000) + 7200,
    };
    mocks.post.mockResolvedValueOnce(parsed).mockResolvedValueOnce(created);

    render(<ComposerView />);
    fireEvent.change(screen.getByLabelText('B站视频链接'), { target: { value: 'BV1B7411m7LV' } });
    fireEvent.click(screen.getByRole('button', { name: '解析视频' }));
    await screen.findByText('测试视频');
    fireEvent.click(screen.getByRole('radio', { name: '群组挑战' }));
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: '发起者' } });
    fireEvent.click(screen.getByRole('button', { name: '生成挑战' }));

    expect(await screen.findByText('群组统一入口链接')).toBeVisible();
    expect(screen.getByText('https://example.com/g/entry/…oken')).toBeVisible();
    expect(screen.getByText('群组结果链接')).toBeVisible();
    expect(screen.queryByText('群组参与链接')).not.toBeInTheDocument();
    expect(readCreatedChallenges()).toEqual([expect.objectContaining({ kind: 'group', entryUrl: created.entryUrl, resultUrl: created.resultUrl })]);
  });

  it('shares the generated challenge image without passing a URL', async () => {
    const nativeShare = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare });
    const created = {
      challengeUrl: 'https://example.com/c/bc1-image-share',
      manageUrl: 'https://example.com/manage#bm1-private-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
    mocks.post.mockResolvedValueOnce(parsed).mockResolvedValueOnce(created);

    render(<ComposerView />);
    fireEvent.change(screen.getByLabelText('B站视频链接'), { target: { value: 'BV1B7411m7LV' } });
    fireEvent.click(screen.getByRole('button', { name: '解析视频' }));
    await screen.findByText('测试视频');
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: '发起者' } });
    fireEvent.click(screen.getByRole('button', { name: '生成挑战' }));

    const shareButton = await screen.findByRole('button', { name: '系统分享图片' });
    await waitFor(() => expect(shareButton).toBeEnabled());
    fireEvent.click(shareButton);
    await waitFor(() => expect(nativeShare).toHaveBeenCalledTimes(1));
    const data = nativeShare.mock.calls[0]?.[0] as { title: string; files: File[]; url?: string };
    expect(data.title).toBe('绷绷炸弹');
    expect(data.files).toHaveLength(1);
    expect(data.files[0]).toBeInstanceOf(File);
    expect(data).not.toHaveProperty('url');
    expect(canShare).toHaveBeenCalledWith({ files: data.files });
  });

  it('copies a share message when image sharing is unavailable', async () => {
    const nativeShare = vi.fn();
    const canShare = vi.fn().mockReturnValue(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const created = {
      challengeUrl: 'https://example.com/c/bc1-copy-fallback',
      manageUrl: 'https://example.com/manage#bm1-private-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
    mocks.post.mockResolvedValueOnce(parsed).mockResolvedValueOnce(created);

    render(<ComposerView />);
    fireEvent.change(screen.getByLabelText('B站视频链接'), { target: { value: 'BV1B7411m7LV' } });
    fireEvent.click(screen.getByRole('button', { name: '解析视频' }));
    await screen.findByText('测试视频');
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: '发起者' } });
    fireEvent.click(screen.getByRole('button', { name: '生成挑战' }));

    const shareButton = await screen.findByRole('button', { name: '系统分享图片' });
    await waitFor(() => expect(shareButton).toBeEnabled());
    fireEvent.click(shareButton);
    expect(nativeShare).not.toHaveBeenCalled();
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining(created.challengeUrl)));
    expect(await screen.findByText('当前浏览器不支持图片分享，分享文案已复制。')).toBeVisible();
    expect(screen.getByRole('button', { name: '复制分享文案' })).toBeVisible();
  });
});
