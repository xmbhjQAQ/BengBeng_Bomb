import { describe, expect, it, vi } from 'vitest';

const qr = vi.hoisted(() => ({
  toDataURL: vi.fn(async (url: string) => `data:image/png;base64,${btoa(url)}`),
}));
vi.mock('qrcode', () => ({ default: qr }));

import { createSettlementCard } from './settlementCard';

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
    strokeStyle: '',
    font: '',
    textAlign: 'start',
    lineWidth: 1,
    lineJoin: 'round',
    lineCap: 'round',
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    setLineDash: vi.fn(),
    fillText: vi.fn((value: string) => labels.push(value)),
    measureText: vi.fn(() => ({ width: 10 })),
    roundRect: vi.fn(),
    save: vi.fn(),
    clip: vi.fn(),
    restore: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  const dimensions: Array<{ width: number; height: number }> = [];
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
    dimensions.push({ width: this.width, height: this.height });
    callback(new Blob(['png'], { type: 'image/png' }));
  });
  const OriginalImage = globalThis.Image;
  class LoadedImage {
    naturalWidth = 0;
    naturalHeight = 0;
    crossOrigin = '';
    referrerPolicy = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  }
  vi.stubGlobal('Image', LoadedImage);
  return {
    labels,
    dimensions,
    restore: () => {
      getContext.mockRestore();
      toBlob.mockRestore();
      vi.stubGlobal('Image', OriginalImage);
    },
  };
}

const stats = {
  total: 8,
  held: 3,
  failed: 5,
  failureRate: 0.625,
  averageElapsedSeconds: 18.4,
  buckets: [{ startSeconds: 0, count: 2 }, { startSeconds: 10, count: 3 }],
};

describe('createSettlementCard', () => {
  it('renders the settlement sections and a public settlement QR', async () => {
    qr.toDataURL.mockClear();
    const canvas = installCanvas();
    try {
      await createSettlementCard({
        publicUrl: 'https://bomb.example/report/br1.public',
        video,
        outcome: 'failed',
        elapsedSeconds: 12.4,
        scoreTrace: [{ timeSeconds: 0, score: 10 }, { timeSeconds: 12.4, score: 82 }],
        stats,
        isGroup: true,
        groupTotal: 4,
      });
      expect(canvas.dimensions[0]).toEqual({ width: 1200, height: expect.any(Number) });
      expect(canvas.dimensions[0]!.height).toBeGreaterThan(2000);
      expect(canvas.labels).toEqual(expect.arrayContaining(['本次表情变化', '大家的挑战情况', '群组进度', '只展示人数汇总', '公开链接已隐藏，请扫码查看', '扫码查看结算页面']));
      expect(canvas.labels).not.toContain('某位参与者');
      expect(qr.toDataURL).toHaveBeenCalledWith('https://bomb.example/report/br1.public', expect.objectContaining({
        width: 520,
        margin: 4,
        errorCorrectionLevel: 'M',
        color: { dark: '#111111', light: '#ffffff' },
      }));
    } finally {
      canvas.restore();
    }
  });

  it('keeps truthful empty states when trace and heatmap data are absent', async () => {
    const canvas = installCanvas();
    try {
      await createSettlementCard({
        publicUrl: 'https://bomb.example/report/br1.empty',
        video,
        outcome: 'held',
        elapsedSeconds: 60,
        scoreTrace: [],
        stats: { ...stats, buckets: [] },
      });
      expect(canvas.labels).toEqual(expect.arrayContaining([
        '这次没有记录到足够的面部变化，暂时无法绘制曲线。',
        '还没有人记录没绷住的时间。',
      ]));
    } finally {
      canvas.restore();
    }
  });

  it('marks a held result at the real video duration', async () => {
    const canvas = installCanvas();
    try {
      await createSettlementCard({
        publicUrl: 'https://bomb.example/report/br1.held',
        video,
        outcome: 'held',
        elapsedSeconds: 60,
        scoreTrace: [{ timeSeconds: 20, score: 42 }],
        stats,
      });
      expect(canvas.labels).toContain('挑战终点');
    } finally {
      canvas.restore();
    }
  });

  it('keeps the long image downloadable when QR generation fails', async () => {
    qr.toDataURL.mockRejectedValueOnce(new Error('qrcode unavailable'));
    const canvas = installCanvas();
    try {
      await expect(createSettlementCard({
        publicUrl: 'https://bomb.example/report/br1.qr-fallback',
        video,
        outcome: 'held',
        elapsedSeconds: 60,
        scoreTrace: [],
        stats,
      })).resolves.toBeInstanceOf(Blob);
      expect(canvas.labels).toContain('二维码暂时无法生成');
    } finally {
      canvas.restore();
    }
  });

  it('rejects a management URL before creating a canvas', async () => {
    const createElement = vi.spyOn(document, 'createElement');
    await expect(createSettlementCard({
      publicUrl: 'https://bomb.example/manage#bm1.private',
      video,
      outcome: 'held',
      elapsedSeconds: 60,
      scoreTrace: [],
      stats,
    })).rejects.toThrow('管理链接不能写入分享卡');
    expect(createElement).not.toHaveBeenCalledWith('canvas');
    createElement.mockRestore();
  });

  it('rejects an attempt credential URL before creating a canvas', async () => {
    const createElement = vi.spyOn(document, 'createElement');
    await expect(createSettlementCard({
      publicUrl: 'https://bomb.example/c/result?attemptToken=private-value',
      video,
      outcome: 'held',
      elapsedSeconds: 60,
      scoreTrace: [],
      stats,
    })).rejects.toThrow('挑战凭证不能写入分享卡');
    expect(createElement).not.toHaveBeenCalledWith('canvas');
    createElement.mockRestore();
  });
});
