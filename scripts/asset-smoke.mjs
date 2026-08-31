import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const baseIndex = process.argv.indexOf('--base');
const base = (baseIndex >= 0 ? process.argv[baseIndex + 1] : 'http://127.0.0.1:8787')?.replace(/\/$/, '');
if (!base) throw new Error('请提供 --base <URL>');

async function check(path, predicate, label) {
  const response = await fetch(`${base}${path}`, { redirect: 'manual' });
  if (!response.ok || !predicate(response)) throw new Error(`${label} 未通过（HTTP ${response.status}）`);
  return response;
}

const page = await check('/', (response) => response.headers.get('content-type')?.includes('text/html') && response.headers.get('Content-Security-Policy')?.includes("frame-ancestors 'none'") && response.headers.get('Permissions-Policy')?.includes('camera=(self)') && response.headers.get('X-Content-Type-Options') === 'nosniff', '首页安全头');
await page.text();
await check('/c/release-smoke', (response) => {
  const cache = response.headers.get('cache-control') ?? '';
  return cache.includes('no-cache') || cache.includes('max-age=0');
}, 'SPA 深链接');
const assetDirectory = join(root, 'dist', 'assets');
const jsAsset = existsSync(assetDirectory) ? readdirSync(assetDirectory).find((name) => name.endsWith('.js')) : undefined;
if (!jsAsset) throw new Error('dist/assets 中没有哈希 JS');
await check(`/assets/${jsAsset}`, (response) => response.headers.get('cache-control')?.includes('immutable') ?? false, '哈希资源缓存');
await check('/vendor/mediapipe/models/face_landmarker.task', (response) => response.headers.get('cache-control')?.includes('max-age=86400') ?? false, 'MediaPipe 模型缓存');
if (existsSync(join(root, 'dist', 'assets', `${jsAsset}.map`))) throw new Error('production 资源仍有 source map');
console.log(`静态资源冒烟通过：${base}`);
