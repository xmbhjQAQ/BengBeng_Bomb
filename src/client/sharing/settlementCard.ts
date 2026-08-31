import QRCode from 'qrcode';
import { CLIENT_CONFIG } from '../../shared/config/client';
import type { AggregateStats, ScorePoint, VideoMetadata } from '../../shared/contracts';
import { assertShareableUrl } from '../../shared/domain/share';
import { createHeatmapBars } from '../app/heatmap';
import { createChartModel } from '../app/scoreTraceChartModel';

const CARD_WIDTH = 1200;
const CARD_PADDING = 72;
const CONTENT_WIDTH = CARD_WIDTH - CARD_PADDING * 2;
const QR_SIZE = 520;
const HEATMAP_COLUMNS = 12;

export interface SettlementCardInput {
  publicUrl: string;
  video: VideoMetadata;
  outcome: 'held' | 'failed';
  elapsedSeconds: number;
  scoreTrace: readonly ScorePoint[];
  stats: AggregateStats;
  isGroup?: boolean;
  groupTotal?: number;
}

/**
 * Render a high-resolution, public-only settlement summary without touching
 * the network or the DOM. The image is intentionally a separate renderer
 * from the invitation card so the latter keeps its established layout.
 */
export async function createSettlementCard(input: SettlementCardInput): Promise<Blob> {
  assertShareableUrl(input.publicUrl);
  if (!input.publicUrl.trim()) throw new Error('公开结算链接不可用');

  const chart = createChartModel(input.scoreTrace, input.video.duration);
  const heatmap = createHeatmapBars(input.stats.buckets);
  const heatmapRows = Math.max(1, Math.ceil(heatmap.length / HEATMAP_COLUMNS));
  const chartHeight = chart.points.length ? 430 : 205;
  const heatmapHeight = heatmap.length ? 120 + heatmapRows * 148 : 170;
  const groupHeight = input.isGroup ? 180 : 0;
  const sectionGaps = input.isGroup ? 6 : 5;
  const height = 48 + 570 + chartHeight + 320 + heatmapHeight + groupHeight + 690 + sectionGaps * 28 + 64;

  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持图片生成');

  paintBackground(ctx, height);
  let y = 48;
  y = await paintHero(ctx, y, input);
  y = paintChart(ctx, y, chart, input);
  y = paintStats(ctx, y, input.stats);
  y = paintHeatmap(ctx, y, heatmap);
  if (input.isGroup) y = paintGroupSummary(ctx, y, input.groupTotal ?? 0);
  y = await paintQr(ctx, y, input.publicUrl, input.isGroup === true);
  paintFooter(ctx, y, input.isGroup === true);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片导出失败')), 'image/png');
  });
}

function paintBackground(ctx: CanvasRenderingContext2D, height: number) {
  const gradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, height);
  gradient.addColorStop(0, '#fff0f4');
  gradient.addColorStop(.42, '#fff9fb');
  gradient.addColorStop(1, '#f2edf8');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CARD_WIDTH, height);
}

async function paintHero(ctx: CanvasRenderingContext2D, y: number, input: SettlementCardInput) {
  const held = input.outcome === 'held';
  const heroHeight = 570;
  const gradient = ctx.createLinearGradient(CARD_PADDING, y, CARD_WIDTH - CARD_PADDING, y + heroHeight);
  gradient.addColorStop(0, held ? '#119b83' : '#df315d');
  gradient.addColorStop(1, '#29213d');
  ctx.fillStyle = gradient;
  roundedRect(ctx, CARD_PADDING, y, CONTENT_WIDTH, heroHeight, 30);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,.78)';
  ctx.font = '700 28px system-ui';
  ctx.fillText('BENG BENG BOMB · 结算', CARD_PADDING + 40, y + 54);
  ctx.fillStyle = '#fff';
  ctx.font = '800 62px system-ui';
  ctx.fillText(held ? '挑战成功' : '没绷住', CARD_PADDING + 40, y + 128);
  ctx.font = '800 116px system-ui';
  ctx.fillText(input.elapsedSeconds.toFixed(1), CARD_PADDING + 40, y + 265);
  ctx.font = '700 30px system-ui';
  ctx.fillText('秒', CARD_PADDING + 330, y + 258);
  ctx.fillStyle = 'rgba(255,255,255,.82)';
  ctx.font = '28px system-ui';
  wrapText(ctx, held ? '全程绷住，挑战成功。' : '这个瞬间击穿了你的防线。', CARD_PADDING + 40, y + 320, CONTENT_WIDTH - 80, 38, 1);
  await drawCover(ctx, input.video.cover, CARD_PADDING + 40, y + 355, CONTENT_WIDTH - 80, 170);
  ctx.fillStyle = '#fff';
  ctx.font = '700 27px system-ui';
  ctx.fillText(fitText(ctx, input.video.title, CONTENT_WIDTH - 80), CARD_PADDING + 40, y + 555);
  return y + heroHeight + 28;
}

function paintChart(ctx: CanvasRenderingContext2D, y: number, model: ReturnType<typeof createChartModel>, input: SettlementCardInput) {
  const height = model.points.length ? 430 : 205;
  panel(ctx, y, height);
  sectionHeading(ctx, y, '本次表情变化', '挑战过程中的难绷程度');
  if (!model.points.length) {
    ctx.fillStyle = '#7f7183';
    ctx.font = '26px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('这次没有记录到足够的面部变化，暂时无法绘制曲线。', CARD_WIDTH / 2, y + 138);
    ctx.textAlign = 'start';
    return y + height + 28;
  }

  const plot = { x: CARD_PADDING + 64, y: y + 112, width: CONTENT_WIDTH - 104, height: 235 };
  ctx.strokeStyle = '#eadfe8';
  ctx.lineWidth = 1;
  for (const value of [0, 25, 50, 75, 100]) {
    const lineY = plot.y + plot.height - (value / 100) * plot.height;
    ctx.beginPath();
    ctx.moveTo(plot.x, lineY);
    ctx.lineTo(plot.x + plot.width, lineY);
    ctx.stroke();
    ctx.fillStyle = '#756878';
    ctx.font = '18px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(String(value), plot.x - 12, lineY + 6);
  }
  ctx.textAlign = 'start';
  const maxTime = model.maxTime;
  const points = model.points.map((point) => ({
    x: plot.x + (point.timeSeconds / maxTime) * plot.width,
    y: plot.y + plot.height - (point.score / 100) * plot.height,
    timeSeconds: point.timeSeconds,
    score: point.score,
  }));
  const threshold = (value: number, color: string, label: string) => {
    const lineY = plot.y + plot.height - (value / 100) * plot.height;
    ctx.strokeStyle = color;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(plot.x, lineY);
    ctx.lineTo(plot.x + plot.width, lineY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = '700 18px system-ui';
    ctx.fillText(`${label} ${value}`, plot.x + plot.width - 120, lineY - 8);
  };
  threshold(CLIENT_CONFIG.scoring.dangerThreshold, '#ad7616', '危险线');
  threshold(CLIENT_CONFIG.scoring.failureThreshold, '#b3224d', '爆炸线');

  ctx.strokeStyle = input.outcome === 'held' ? '#159a80' : '#c42b59';
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle;
  const last = points.at(-1)!;
  ctx.beginPath();
  ctx.arc(last.x, last.y, 9, 0, Math.PI * 2);
  ctx.fill();
  if (input.outcome === 'held') {
    const endpointX = plot.x + (input.video.duration / maxTime) * plot.width;
    ctx.strokeStyle = '#159a80';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(endpointX, plot.y);
    ctx.lineTo(endpointX, plot.y + plot.height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#159a80';
    ctx.font = '700 18px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText('挑战终点', endpointX - 8, plot.y + 22);
    ctx.textAlign = 'start';
  }
  ctx.fillStyle = '#756878';
  ctx.font = '18px system-ui';
  ctx.fillText('0 秒', plot.x, plot.y + plot.height + 34);
  ctx.textAlign = 'right';
  ctx.fillText(`${maxTime.toFixed(0)} 秒`, plot.x + plot.width, plot.y + plot.height + 34);
  ctx.textAlign = 'start';

  const peak = points.reduce((best, point) => point.score > best.score ? point : best);
  const markerTime = input.outcome === 'held' ? input.video.duration : last.timeSeconds;
  ctx.fillStyle = '#624c60';
  ctx.font = '700 22px system-ui';
  wrapText(ctx, `最高程度 ${peak.score} · ${peak.timeSeconds.toFixed(1)} 秒 · 危险时刻 ${model.dangerCount} · ${input.outcome === 'held' ? '挑战终点' : '没绷住时刻'} ${markerTime.toFixed(1)} 秒`, CARD_PADDING + 40, y + 382, CONTENT_WIDTH - 80, 28, 2);
  return y + height + 28;
}

function paintStats(ctx: CanvasRenderingContext2D, y: number, stats: AggregateStats) {
  const height = 320;
  panel(ctx, y, height);
  sectionHeading(ctx, y, '大家的挑战情况', '匿名统计');
  const values: Array<[string, string]> = [
    [String(stats.total), '挑战次数'],
    [String(stats.held), '绷住人数'],
    [`${(stats.failureRate * 100).toFixed(0)}%`, '没绷住比例'],
    [`${stats.averageElapsedSeconds.toFixed(1)}s`, '平均坚持时间'],
  ];
  const gap = 16;
  const width = (CONTENT_WIDTH - gap * 3 - 80) / 4;
  values.forEach(([value, label], index) => {
    const x = CARD_PADDING + 40 + index * (width + gap);
    ctx.fillStyle = '#f8eff5';
    roundedRect(ctx, x, y + 105, width, 132, 16);
    ctx.fill();
    ctx.fillStyle = '#ad2e5b';
    ctx.font = '800 42px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(value, x + width / 2, y + 165);
    ctx.fillStyle = '#756878';
    ctx.font = '20px system-ui';
    ctx.fillText(label, x + width / 2, y + 205);
  });
  ctx.textAlign = 'start';
  return y + height + 28;
}

function paintHeatmap(ctx: CanvasRenderingContext2D, y: number, bars: ReturnType<typeof createHeatmapBars>) {
  const height = bars.length ? 120 + Math.max(1, Math.ceil(bars.length / HEATMAP_COLUMNS)) * 148 : 170;
  panel(ctx, y, height);
  sectionHeading(ctx, y, '没绷住的时间分布', '失败热力图');
  if (!bars.length) {
    ctx.fillStyle = '#7f7183';
    ctx.font = '24px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('还没有人记录没绷住的时间。', CARD_WIDTH / 2, y + 132);
    ctx.textAlign = 'start';
    return y + height + 28;
  }
  const maxCount = Math.max(...bars.map((bar) => bar.count));
  const gap = 12;
  const cellWidth = (CONTENT_WIDTH - 80 - gap * (HEATMAP_COLUMNS - 1)) / HEATMAP_COLUMNS;
  bars.forEach((bar, index) => {
    const row = Math.floor(index / HEATMAP_COLUMNS);
    const column = index % HEATMAP_COLUMNS;
    const x = CARD_PADDING + 40 + column * (cellWidth + gap);
    const cellY = y + 100 + row * 148;
    ctx.fillStyle = '#251b2b';
    roundedRect(ctx, x, cellY, cellWidth, 124, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 18px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`${bar.count} 人`, x + cellWidth / 2, cellY + 25);
    const barHeight = Math.max(20, 72 * (bar.count / maxCount));
    ctx.fillStyle = '#df315d';
    roundedRect(ctx, x + cellWidth / 2 - 12, cellY + 95 - barHeight, 24, barHeight, 8);
    ctx.fill();
    ctx.fillStyle = '#e9dbe7';
    ctx.font = '15px system-ui';
    ctx.fillText(`${bar.startSeconds}s`, x + cellWidth / 2, cellY + 114);
  });
  ctx.textAlign = 'start';
  return y + height + 28;
}

function paintGroupSummary(ctx: CanvasRenderingContext2D, y: number, total: number) {
  const height = 180;
  panel(ctx, y, height);
  sectionHeading(ctx, y, '群组进度', '只展示人数汇总');
  ctx.fillStyle = '#a22a54';
  ctx.font = '800 44px system-ui';
  ctx.fillText(`${Math.max(0, Math.floor(total))} 人`, CARD_PADDING + 42, y + 145);
  ctx.fillStyle = '#756878';
  ctx.font = '22px system-ui';
  ctx.fillText('已完成参与人数 · 详细结果扫码查看', CARD_PADDING + 250, y + 140);
  return y + height + 28;
}

async function paintQr(ctx: CanvasRenderingContext2D, y: number, url: string, isGroup: boolean) {
  const height = 690;
  panel(ctx, y, height);
  sectionHeading(ctx, y, '查看结算', isGroup ? '扫码打开群组结果页' : '扫码打开公开战报');
  let image: HTMLImageElement | null = null;
  try {
    const qr = await QRCode.toDataURL(url, {
      width: QR_SIZE,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#111111', light: '#ffffff' },
    });
    const loadedImage = new Image();
    await new Promise<void>((resolve, reject) => {
      loadedImage.onload = () => resolve();
      loadedImage.onerror = () => reject(new Error('二维码生成失败'));
      loadedImage.src = qr;
    });
    image = loadedImage;
  } catch {
    // 结算长图仍应可下载；二维码失败时保留品牌化占位和文字提示，避免暴露完整链接。
  }
  const x = (CARD_WIDTH - QR_SIZE) / 2;
  ctx.fillStyle = '#fff';
  roundedRect(ctx, x - 22, y + 92, QR_SIZE + 44, QR_SIZE + 44, 16);
  ctx.fill();
  if (image) {
    ctx.drawImage(image, x, y + 114, QR_SIZE, QR_SIZE);
  } else {
    ctx.fillStyle = '#f7edf3';
    roundedRect(ctx, x + 30, y + 144, QR_SIZE - 60, QR_SIZE - 60, 12);
    ctx.fill();
    ctx.fillStyle = '#8b7186';
    ctx.font = '700 26px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('二维码暂时无法生成', CARD_WIDTH / 2, y + 360);
    ctx.font = '20px system-ui';
    ctx.fillText('请返回页面复制链接查看', CARD_WIDTH / 2, y + 402);
  }
  ctx.fillStyle = '#624c60';
  ctx.font = '700 28px system-ui';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#8b7186';
  ctx.font = '20px system-ui';
  ctx.fillText('公开链接已隐藏，请扫码查看', CARD_WIDTH / 2, y + 625);
  ctx.fillStyle = '#624c60';
  ctx.font = '700 28px system-ui';
  ctx.fillText('扫码查看结算页面', CARD_WIDTH / 2, y + 675);
  ctx.textAlign = 'start';
  return y + height + 28;
}

function paintFooter(ctx: CanvasRenderingContext2D, y: number, isGroup: boolean) {
  ctx.fillStyle = '#806f82';
  ctx.font = '20px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(isGroup ? '群组结果为公开汇总，详细名单请打开结果页' : '公开战报不包含摄像头画面或原始面部数据', CARD_WIDTH / 2, y + 24);
  ctx.textAlign = 'start';
}

function panel(ctx: CanvasRenderingContext2D, y: number, height: number) {
  ctx.fillStyle = 'rgba(255,255,255,.94)';
  roundedRect(ctx, CARD_PADDING, y, CONTENT_WIDTH, height, 26);
  ctx.fill();
}

function sectionHeading(ctx: CanvasRenderingContext2D, y: number, title: string, subtitle: string) {
  ctx.fillStyle = '#2a202c';
  ctx.font = '800 34px system-ui';
  ctx.fillText(title, CARD_PADDING + 40, y + 58);
  ctx.fillStyle = '#9b899d';
  ctx.font = '20px system-ui';
  ctx.fillText(subtitle, CARD_PADDING + 40, y + 88);
}

async function drawCover(ctx: CanvasRenderingContext2D, url: string, x: number, y: number, width: number, height: number) {
  ctx.save();
  roundedRect(ctx, x, y, width, height, 20);
  ctx.clip();
  const image = await loadImage(url);
  if (image && image.naturalWidth > 0 && image.naturalHeight > 0) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawnWidth = image.naturalWidth * scale;
    const drawnHeight = image.naturalHeight * scale;
    ctx.drawImage(image, x + (width - drawnWidth) / 2, y + (height - drawnHeight) / 2, drawnWidth, drawnHeight);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = 'rgba(255,255,255,.86)';
    ctx.font = '600 26px system-ui';
    ctx.fillText('视频封面暂时无法加载', x + 32, y + height / 2);
  }
  ctx.restore();
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.referrerPolicy = 'no-referrer';
  return new Promise((resolve) => {
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
  let line = '';
  let lines = 0;
  for (const character of text) {
    if (ctx.measureText(line + character).width > maxWidth) {
      ctx.fillText(line, x, y + lines * lineHeight);
      lines += 1;
      if (lines >= maxLines) return;
      line = character;
    } else {
      line += character;
    }
  }
  if (line && lines < maxLines) ctx.fillText(line, x, y + lines * lineHeight);
}

function fitText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number) {
  const normalized = value.trim();
  if (!normalized || ctx.measureText(normalized).width <= maxWidth) return normalized;
  let fitted = '';
  for (const character of normalized) {
    const candidate = `${fitted}${character}…`;
    if (ctx.measureText(candidate).width > maxWidth) break;
    fitted += character;
  }
  return `${fitted}…`;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}
