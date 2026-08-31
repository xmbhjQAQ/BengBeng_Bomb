import { describe, expect, it, vi } from 'vitest';

const qr = vi.hoisted(() => ({ toDataURL: vi.fn(async (url: string, options?: unknown) => { void options; return `data:image/png;base64,${btoa(url)}`; }) }));
vi.mock('qrcode', () => ({ default: qr }));

import { createShareCard } from './card';

const video = {
  source: 'bilibili' as const,
  bvid: 'BV1B7411m7LV',
  cid: 1,
  page: 1,
  title: '测试视频',
  description: '',
  cover: '',
  duration: 60,
};

function installCanvas() {
  const labels: string[] = [];
  const context = {
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    fillStyle: '',
    font: '',
    textAlign: 'start',
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn((value: string) => labels.push(value)),
    measureText: vi.fn(() => ({ width: 10 })),
    roundRect: vi.fn(),
    save: vi.fn(),
    clip: vi.fn(),
    restore: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })));
  const OriginalImage = globalThis.Image;
  class LoadedImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  }
  vi.stubGlobal('Image', LoadedImage);
  return { labels, restore: () => { getContext.mockRestore(); toBlob.mockRestore(); vi.stubGlobal('Image', OriginalImage); } };
}

describe('share card QR layout', () => {
  it('keeps classic cards to one public QR', async () => {
    qr.toDataURL.mockClear();
    const canvas = installCanvas();
    try {
      await createShareCard({ url: 'https://bomb.example/c/bc1.challenge', video, heading: '单人挑战', lines: ['看看你能否绷住。'] });
      expect(qr.toDataURL).toHaveBeenCalledTimes(1);
      expect(qr.toDataURL).toHaveBeenCalledWith('https://bomb.example/c/bc1.challenge', expect.objectContaining({ width: 360, margin: 4, errorCorrectionLevel: 'M' }));
      expect(canvas.labels).toContain('扫码接受挑战');
      expect(canvas.labels).toEqual(expect.arrayContaining(['BENG BENG BOMB · 挑战', '来挑战一下', '开始挑战']));
    } finally {
      canvas.restore();
    }
  });

  it('renders a group universal entry as one public QR target', async () => {
    qr.toDataURL.mockClear();
    const canvas = installCanvas();
    try {
      await createShareCard({ url: 'https://bomb.example/g/entry/bge1.entry', video, heading: '群组挑战', lines: ['扫码后可参加或查看结果'], qrLabel: '群组统一入口' });
      expect(qr.toDataURL).toHaveBeenCalledTimes(1);
      expect(qr.toDataURL).toHaveBeenCalledWith('https://bomb.example/g/entry/bge1.entry', expect.objectContaining({ width: 360, margin: 4, errorCorrectionLevel: 'M' }));
      expect(canvas.labels).toContain('群组统一入口');
    } finally {
      canvas.restore();
    }
  });
});
