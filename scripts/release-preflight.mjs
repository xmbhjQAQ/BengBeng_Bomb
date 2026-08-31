import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const envIndex = args.indexOf('--env');
const target = envIndex >= 0 ? args[envIndex + 1] : 'local';
const secretsChecked = args.includes('--secrets-checked');
const errors = [];
const warnings = [];

function readJsonc(path) {
  const source = readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(source);
}

function parseDevVars() {
  const values = {};
  const path = join(root, '.dev.vars');
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function isPlaceholder(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return !normalized || normalized.includes('replace-with') || normalized === '00000000-0000-0000-0000-000000000000';
}

function isHttpsOrigin(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function trackedTextContains(secret) {
  if (!secret) return false;
  let files = [];
  try {
    files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  } catch {
    return false;
  }
  return files.some((file) => {
    try {
      const stat = readFileSync(join(root, file));
      return stat.byteLength < 2_000_000 && stat.toString('utf8').includes(secret);
    } catch {
      return false;
    }
  });
}

function findMaps(directory) {
  if (!existsSync(directory)) return [];
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...findMaps(path));
    else if (entry.name.endsWith('.map')) found.push(path);
  }
  return found;
}

const wranglerPath = join(root, 'wrangler.jsonc');
const config = readJsonc(wranglerPath);
const selected = target === 'local' ? config : config.env?.[target];
if (!selected) errors.push(`Wrangler 环境 ${target} 未定义`);

const mergedVars = { ...(config.vars ?? {}), ...(selected?.vars ?? {}) };
const d1 = selected?.d1_databases?.[0] ?? (target === 'local' ? config.d1_databases?.[0] : undefined);
if (!d1) errors.push('缺少 D1 binding');
if (target !== 'local' && isPlaceholder(d1?.database_id)) errors.push('目标环境仍使用占位 D1 database_id');
if (target !== 'local' && !isHttpsOrigin(mergedVars.PUBLIC_ORIGIN)) errors.push('目标环境缺少 HTTPS 根地址 PUBLIC_ORIGIN');
if (target !== 'local') {
  if (String(mergedVars.APP_ENV ?? '').toLowerCase() !== target.toLowerCase()) errors.push(`目标环境 APP_ENV 必须为 ${target}`);
  const names = new Set((selected?.ratelimits ?? []).map((item) => item?.name));
  for (const name of ['RATE_LIMITER_EXPENSIVE', 'RATE_LIMITER_MUTATION', 'RATE_LIMITER_PUBLIC']) {
    if (!names.has(name)) errors.push(`目标环境缺少 Rate Limiting binding ${name}`);
  }
  if (!secretsChecked) errors.push('部署前请确认目标环境已配置两个 Secret；确认后重跑并附加 --secrets-checked');
}

const devVars = parseDevVars();
if (target === 'local') {
  if (String(devVars.APP_SIGNING_SECRET ?? '').length < 32) errors.push('本地 APP_SIGNING_SECRET 缺失或过短');
  if (!String(devVars.BILIDIRECT_API_KEY ?? '').trim() || isPlaceholder(devVars.BILIDIRECT_API_KEY)) errors.push('本地 BILIDIRECT_API_KEY 缺失或仍是示例值');
}
for (const name of ['APP_SIGNING_SECRET', 'BILIDIRECT_API_KEY']) {
  if (trackedTextContains(devVars[name])) errors.push(`${name} 值出现在 Git 跟踪文件中`);
}

const maps = findMaps(join(root, 'dist'));
if (target !== 'local' && maps.length) errors.push('dist 含公开 source map，请使用 production build 清理后重试');
else if (maps.length) warnings.push(`dist 当前含 ${maps.length} 个 source map（本地调试允许，发布前请用 production build）`);

if (errors.length) {
  console.error(`发布预检失败（${target}）：`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`发布预检通过（${target}）：配置结构、密钥边界和构建产物检查通过。`);
}
for (const warning of warnings) console.warn(`- 提示：${warning}`);
