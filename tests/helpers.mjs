// 测试辅助：让测试在 Node 22（需要 flag）与 Node 24（默认可用）下都能跑
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** node:sqlite 是否需要显式 --experimental-sqlite */
export function needsSqliteFlag() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major < 23 || (major === 23 && minor < 4);
}

/** 启动 server.js 的参数列表 */
export function serverArgs(script = 'server.js') {
  return [...(needsSqliteFlag() ? ['--experimental-sqlite'] : []), '--no-warnings', path.join(ROOT, script)];
}

/** 向系统要一个空闲端口 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = netCreate();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

import net from 'node:net';
function netCreate() {
  return net.createServer();
}
