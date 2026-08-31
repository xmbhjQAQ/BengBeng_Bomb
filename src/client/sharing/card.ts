import QRCode from 'qrcode';
import type { AggregateStats, VideoMetadata } from '../../shared/contracts';
import { assertShareableUrl } from '../../shared/domain/share';

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 1500;
const CARD_PADDING = 72;
const CONTENT_WIDTH = CARD_WIDTH - CARD_PADDING * 2;
const PANEL_GAP = 28;
const HERO_HEIGHT = 540;
const MESSAGE_HEIGHT = 245;
const QR_PANEL_HEIGHT = 560;

const COLORS = {
  ink: '#2a202c',
  muted: '#756878',
  softMuted: '#9b899d',
  accent: '#ad2e5b',
  panel: 'rgba(255,255,255,.94)',
  heroStart: '#df315d',
  heroEnd: '#29213d',
} as const;

export interface ShareCardInput {
  url: string;
  video: VideoMetadata;
  heading: string;
  lines: string[];
  stats?: AggregateStats;
  qrLabel?: string;
}

/**
 * Render the invitation card with the same light canvas, dark hero and white
 * panels used by the settlement card. The QR targets remain public-only.
 */
export async function createShareCard(input: ShareCardInput): Promise<Blob> {
  assertShareableUrl(input.url);

  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持图片生成');

  paintBackground(ctx);
  let y = 48;
  y = await paintHero(ctx, y, input);
  y = paintMessage(ctx, y, input);
  y = await paintQrPanel(ctx, y, input.url, input.qrLabel ?? '扫码接受挑战');
  paintFooter(ctx, y);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('图片导出失败'))),
      'image/png',
    );
  });
}

function paintBackground(ctx: CanvasRenderingContext2D) {
  const gradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  gradient.addColorStop(0, '#fff0f4');
  gradient.addColorStop(.42, '#fff9fb');
  gradient.addColorStop(1, '#f2edf8');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
}

async function paintHero(ctx: CanvasRenderingContext2D, y: number, input: ShareCardInput) {
  const gradient = ctx.createLinearGradient(CARD_PADDING, y, CARD_WIDTH - CARD_PADDING, y + HERO_HEIGHT);
  gradient.addColorStop(0, COLORS.heroStart);
  gradient.addColorStop(1, COLORS.heroEnd);
  ctx.fillStyle = gradient;
  panelRect(ctx, CARD_PADDING, y, CONTENT_WIDTH, HERO_HEIGHT, 30);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,.78)';
  ctx.font = '700 28px system-ui';
  ctx.fillText('BENG BENG BOMB · 挑战', CARD_PADDING + 40, y + 54);
  ctx.fillStyle = '#fff';
  ctx.font = '800 62px system-ui';
  ctx.fillText(fitText(ctx, input.heading, CONTENT_WIDTH - 80), CARD_PADDING + 40, y + 128);
  ctx.font = '700 29px system-ui';
  wrap(ctx, input.video.title, CARD_PADDING + 40, y + 176, CONTENT_WIDTH - 80, 38, 2);
  await drawCover(ctx, input.video.cover, CARD_PADDING + 40, y + 236, CONTENT_WIDTH - 80, 205);
  ctx.fillStyle = 'rgba(255,255,255,.82)';
  ctx.font = '24px system-ui';
  ctx.fillText(`${Math.round(input.video.duration)} 秒视频 · B站挑战`, CARD_PADDING + 40, y + 493);
  return y + HERO_HEIGHT + PANEL_GAP;
}

function paintMessage(ctx: CanvasRenderingContext2D, y: number, input: ShareCardInput) {
  panel(ctx, y, MESSAGE_HEIGHT);
  sectionHeading(ctx, y, '来挑战一下', '把这张图发给朋友或群聊');
  ctx.fillStyle = COLORS.ink;
  ctx.font = '700 27px system-ui';
  input.lines.slice(0, 3).forEach((line, index) => {
    wrap(ctx, line, CARD_PADDING + 40, y + 132 + index * 36, CONTENT_WIDTH - 80, 32, 1);
  });
  if (input.stats) {
    ctx.fillStyle = COLORS.accent;
    ctx.font = '700 22px system-ui';
    ctx.fillText(
      `${input.stats.total} 次挑战 · ${(input.stats.failureRate * 100).toFixed(0)}% 没绷住`,
      CARD_PADDING + 40,
      y + 213,
    );
  }
  return y + MESSAGE_HEIGHT + PANEL_GAP;
}

async function paintQrPanel(ctx: CanvasRenderingContext2D, y: number, url: string, label: string) {
  panel(ctx, y, QR_PANEL_HEIGHT);
  sectionHeading(ctx, y, '开始挑战', label);
  const size = 360;
  await drawQr(ctx, url, label, (CARD_WIDTH - size) / 2, y + 108, size);
  return y + QR_PANEL_HEIGHT + PANEL_GAP;
}

function paintFooter(ctx: CanvasRenderingContext2D, y: number) {
  ctx.fillStyle = '#806f82';
  ctx.font = '20px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('摄像头画面只在你的浏览器中处理', CARD_WIDTH / 2, y + 18);
  ctx.textAlign = 'start';
}

function panel(ctx: CanvasRenderingContext2D, y: number, height: number) {
  ctx.fillStyle = COLORS.panel;
  panelRect(ctx, CARD_PADDING, y, CONTENT_WIDTH, height, 26);
  ctx.fill();
}

function sectionHeading(ctx: CanvasRenderingContext2D, y: number, title: string, subtitle: string) {
  ctx.fillStyle = COLORS.ink;
  ctx.font = '800 34px system-ui';
  ctx.fillText(title, CARD_PADDING + 40, y + 58);
  ctx.fillStyle = COLORS.softMuted;
  ctx.font = '20px system-ui';
  ctx.fillText(subtitle, CARD_PADDING + 40, y + 88);
}

async function drawQr(ctx: CanvasRenderingContext2D, url: string, label: string, x: number, y: number, size: number) {
  const qr = await QRCode.toDataURL(url, {
    width: size,
    margin: 4,
    errorCorrectionLevel: 'M',
    color: { dark: '#111111', light: '#ffffff' },
  });
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('二维码生成失败'));
    image.src = qr;
  });
  const padding = Math.max(8, Math.round(size * .025));
  ctx.fillStyle = '#fff';
  panelRect(ctx, x - padding, y - padding, size + padding * 2, size + padding * 2, 12);
  ctx.fill();
  ctx.drawImage(image, x, y, size, size);
  ctx.font = size >= 280 ? '24px system-ui' : '20px system-ui';
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'center';
  ctx.fillText(label, x + size / 2, y + size + 38);
  ctx.textAlign = 'start';
}

export async function drawCover(ctx: CanvasRenderingContext2D, url: string, x: number, y: number, width: number, height: number) {
  ctx.save();
  panelRect(ctx, x, y, width, height, 20);
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,.24)';
  ctx.fillRect(x, y, width, height);
  const image = await loadCover(url);
  if (image) {
    const sourceWidth = image.naturalWidth || image.width || 16;
    const sourceHeight = image.naturalHeight || image.height || 9;
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const drawnWidth = sourceWidth * scale;
    const drawnHeight = sourceHeight * scale;
    ctx.drawImage(image, x + (width - drawnWidth) / 2, y + (height - drawnHeight) / 2, drawnWidth, drawnHeight);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.font = '600 30px system-ui';
    ctx.fillText('视频封面暂时无法加载', x + 48, y + height / 2);
  }
  ctx.restore();
}

async function loadCover(url: string) {
  if (!url) return null;
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.referrerPolicy = 'no-referrer';
  return new Promise<HTMLImageElement | null>((resolve) => {
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineHeight: number, max: number) {
  let line = '';
  let lines = 0;
  for (const character of text) {
    if (ctx.measureText(line + character).width > width) {
      ctx.fillText(line, x, y + lines * lineHeight);
      line = character;
      lines++;
      if (lines >= max) return;
    } else {
      line += character;
    }
  }
  if (line && lines < max) ctx.fillText(line, x, y + lines * lineHeight);
}

function fitText(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  let result = '';
  for (const character of text) {
    if (ctx.measureText(`${result}${character}…`).width > width) break;
    result += character;
  }
  return `${result}…`;
}

function panelRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  panelRect(ctx, x, y, w, h, r);
}

export function downloadBlob(blob: Blob, name: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
