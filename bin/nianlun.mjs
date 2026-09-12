#!/usr/bin/env node
// 版本感知启动器：node:sqlite 在 Node 22.5–23.3 需要 --experimental-sqlite，
// 23.4+ 已默认可用。这里统一处理，避免用户记不住版本差异。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
const needsFlag = major < 23 || (major === 23 && minor < 4);

if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`\n[年轮] 需要 Node.js 22.5.0 或更高版本，当前为 v${process.versions.node}。\n`);
  process.exit(1);
}

const serverPath = fileURLToPath(new URL('../server.js', import.meta.url));

const args = [];
if (needsFlag) args.push('--experimental-sqlite', '--no-warnings=ExperimentalWarning');
args.push(serverPath, ...process.argv.slice(2));

if (needsFlag) {
  console.log(`[年轮] Node v${process.versions.node} 需要 --experimental-sqlite，已自动附加。`);
}
console.log('[年轮] 提示：生产环境建议使用 Node 24+（无需该参数）。');

const child = spawn(process.execPath, args, { stdio: 'inherit' });

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('[年轮] 启动失败：', err.message);
  process.exit(1);
});
