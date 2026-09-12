// 前端静态资源 + 接口连通性冒烟测试
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, serverArgs, freePort } from './helpers.mjs';

const PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = path.join(ROOT, 'data-smoke');
fs.rmSync(dataDir, { recursive: true, force: true });

const child = spawn(process.execPath, serverArgs(), {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));

const deadline = Date.now() + 15000;
while (Date.now() < deadline) {
  try {
    const r = await fetch(`${BASE}/api/health`);
    if (r.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 120));
}

const urls = [
  '/api/health',
  '/api/setup/status',
  '/',
  '/css/app.css',
  '/js/app.js',
  '/js/util.js',
  '/js/api.js',
  '/js/shell.js',
  '/js/components.js',
  '/js/views/auth.js',
  '/js/views/home.js',
  '/js/views/timeline.js',
  '/js/views/insights.js',
  '/js/views/manage.js',
  '/js/views/settings.js',
  '/js/views/record.js',
  '/js/views/template.js',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/#/home',
];

let bad = 0;
for (const u of urls) {
  try {
    const r = await fetch(BASE + u);
    const t = await r.text();
    const ok = r.status === 200 && t.length > 0;
    if (!ok) bad += 1;
    console.log(`${String(r.status).padEnd(4)} ${String(t.length).padStart(7)}  ${u}`);
  } catch (e) {
    bad += 1;
    console.log(`ERR  ${' '.repeat(7)}  ${u}  ${e.message}`);
  }
}

// 检查 index.html 里引用的图标 id 是否都在 sprite 里定义了
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const defined = new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
const usedFiles = [
  'public/js/util.js',
  'public/js/shell.js',
  'public/js/components.js',
  'public/js/views/auth.js',
  'public/js/views/home.js',
  'public/js/views/timeline.js',
  'public/js/views/insights.js',
  'public/js/views/manage.js',
  'public/js/views/settings.js',
  'public/js/views/record.js',
  'public/js/views/template.js',
];
const used = new Map();
for (const f of usedFiles) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/icon\(\s*'([a-z-]+)'/g)) {
    if (!used.has(m[1])) used.set(m[1], f);
  }
}
const missing = [...used.entries()].filter(([name]) => !defined.has(`ic-${name}`));
console.log('');
console.log(`图标 sprite 定义 ${defined.size} 个，代码引用 ${used.size} 个`);
if (missing.length) {
  bad += missing.length;
  for (const [name, f] of missing) console.log(`  ✗ 缺少图标 ic-${name}（引用于 ${f}）`);
} else {
  console.log('  ✓ 所有引用的图标都已定义');
}

child.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 500));
fs.rmSync(dataDir, { recursive: true, force: true });

if (bad) {
  console.log(`\n服务日志：\n${log}`);
  console.log(`\n✗ 有 ${bad} 项未通过`);
  process.exit(1);
}
console.log('\n✓ 静态资源与接口全部正常');
