import { describe, expect, it, vi } from 'vitest';
import { shareImageFile, type ShareImageEnvironment } from './shareImage';

const file = new File(['png'], 'challenge.png', { type: 'image/png' });

class FakeClipboardItem {
  constructor(readonly data: Record<string, Blob>) {}
}

function environment(overrides: ShareImageEnvironment['navigator'] = {}, clipboardItem = FakeClipboardItem): ShareImageEnvironment {
  return { navigator: overrides, ClipboardItem: clipboardItem as unknown as typeof ClipboardItem };
}

describe('shareImageFile', () => {
  it('shares only the title and image file when native file sharing is supported', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    const result = await shareImageFile(file, 'share copy', environment({ share, canShare }));
    expect(result).toEqual({ status: 'shared' });
    expect(canShare).toHaveBeenCalledWith({ files: [file] });
    expect(share).toHaveBeenCalledWith({ title: '绷绷炸弹', files: [file] });
    expect(share.mock.calls[0]?.[0]).not.toHaveProperty('url');
    expect(share.mock.calls[0]?.[0]).not.toHaveProperty('text');
  });

  it('tries native share when canShare is unavailable', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const result = await shareImageFile(file, 'share copy', environment({ share }));
    expect(result).toEqual({ status: 'shared' });
    expect(share).toHaveBeenCalledTimes(1);
  });

  it('copies the image after an unsupported native capability', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const share = vi.fn();
    const canShare = vi.fn().mockReturnValue(false);
    const result = await shareImageFile(file, 'share copy', environment({ share, canShare, clipboard: { write } }));
    expect(result).toEqual({ status: 'image-copied' });
    expect(share).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('falls back to text when image clipboard writing fails', async () => {
    const write = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const result = await shareImageFile(file, 'share copy', environment({ canShare: () => false, clipboard: { write } }));
    expect(result).toEqual({ status: 'text-copied' });
    expect(writeText).toHaveBeenCalledWith('share copy');
    vi.unstubAllGlobals();
  });

  it('does not touch the clipboard when the user cancels native share', async () => {
    const write = vi.fn();
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    const result = await shareImageFile(file, 'share copy', environment({ share, canShare: () => true, clipboard: { write } }));
    expect(result).toEqual({ status: 'cancelled' });
    expect(write).not.toHaveBeenCalled();
  });
});
