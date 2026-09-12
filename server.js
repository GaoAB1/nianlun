// 年轮 Nianlun —— 零依赖 HTTP 服务（Node 内置 http + node:sqlite）
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { openDatabase, isInitialized, getSetting, setSetting, nowSec } from './src/db.js';
import { SESSION_COOKIE, purgeExpiredSessions, userFromToken } from './src/auth.js';
import { HttpError, assertSameOrigin, parseCookies, readJson, sendError, sendJson, serveStatic, unauthorized } from './src/http.js';
import * as authApi from './src/api/auth.js';
import * as dataApi from './src/api/data.js';
import * as statsApi from './src/api/stats.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');

const config = {
  port: Number(process.env.PORT) || 8080,
  host: process.env.HOST || '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data')),
  uploadDir: null,
  publicDir: PUBLIC_DIR,
  version: process.env.APP_VERSION || '1.0.0',
};
config.uploadDir = path.join(config.dataDir, 'uploads');
fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = openDatabase(path.join(config.dataDir, 'nianlun.db'));
setSetting(db, 'site_name', process.env.SITE_NAME || getSetting(db, 'site_name', '年轮'));

// -------------------- 路由表 --------------------
const AUTH = 'auth';
const ADMIN = 'admin';
const OPEN = 'open';

const routes = [
  ['GET', '/api/setup/status', authApi.setupStatus, OPEN],
  ['POST', '/api/setup/admin', authApi.createAdmin, OPEN],

  ['POST', '/api/auth/login', authApi.login, OPEN],
  ['POST', '/api/auth/logout', authApi.logout, AUTH],
  ['GET', '/api/auth/me', authApi.me, AUTH],
  ['PATCH', '/api/auth/profile', authApi.updateOwnProfile, AUTH],
  ['POST', '/api/auth/password', authApi.changeOwnPassword, AUTH],

  ['GET', '/api/users', authApi.listUsers, ADMIN],
  ['POST', '/api/users', authApi.createUser, ADMIN],
  ['PATCH', '/api/users/:id', authApi.patchUser, ADMIN],
  ['DELETE', '/api/users/:id', authApi.removeUser, ADMIN],
  ['POST', '/api/users/:id/password', authApi.resetUserPassword, ADMIN],
  ['PUT', '/api/settings', authApi.updateSettings, ADMIN],

  ['GET', '/api/groups', dataApi.listGroups, AUTH],
  ['POST', '/api/groups', dataApi.createGroup, AUTH],
  ['PUT', '/api/groups/order', dataApi.reorderGroups, AUTH],
  ['PATCH', '/api/groups/:id', dataApi.patchGroup, AUTH],
  ['DELETE', '/api/groups/:id', dataApi.removeGroup, AUTH],

  ['GET', '/api/templates', dataApi.listTemplates, AUTH],
  ['POST', '/api/templates', dataApi.createTemplate, AUTH],
  ['PUT', '/api/templates/order', dataApi.reorderTemplates, AUTH],
  ['GET', '/api/templates/:id', dataApi.getTemplate, AUTH],
  ['PATCH', '/api/templates/:id', dataApi.patchTemplate, AUTH],
  ['DELETE', '/api/templates/:id', dataApi.removeTemplate, AUTH],
  ['GET', '/api/templates/:id/calendar', statsApi.templateCalendar, AUTH],

  ['GET', '/api/entries', dataApi.listEntries, AUTH],
  ['POST', '/api/entries', dataApi.createEntry, AUTH],
  ['PATCH', '/api/entries/:id', dataApi.patchEntry, AUTH],
  ['DELETE', '/api/entries/:id', dataApi.removeEntry, AUTH],

  ['GET', '/api/tags', dataApi.listTags, AUTH],

  ['GET', '/api/stats/overview', statsApi.overview, AUTH],
  ['GET', '/api/stats/heatmap', statsApi.heatmap, AUTH],
  ['GET', '/api/stats/distribution', statsApi.distribution, AUTH],
  ['GET', '/api/stats/trend', statsApi.trend, AUTH],
  ['GET', '/api/stats/tags', statsApi.tagStats, AUTH],

  ['POST', '/api/uploads', dataApi.uploadImage, AUTH],

  ['GET', '/api/export', statsApi.exportData, AUTH],
  ['POST', '/api/import', statsApi.importData, AUTH],
  ['POST', '/api/data/clear', statsApi.clearData, AUTH],
];

const compiled = routes.map(([method, pattern, handler, guard]) => {
  const parts = pattern.split('/').filter(Boolean);
  return { method, parts, handler, guard, pattern };
});

function matchRoute(method, pathname) {
  const segs = pathname.split('/').filter(Boolean);
  let pathExists = false;
  for (const route of compiled) {
    if (route.parts.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < route.parts.length; i += 1) {
      const p = route.parts[i];
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
      else if (p !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    pathExists = true;
    if (route.method === method) return { route, params };
  }
  return pathExists ? { methodMismatch: true } : null;
}

function health() {
  return {
    ok: true,
    name: getSetting(db, 'site_name', '年轮'),
    version: config.version,
    initialized: isInitialized(db),
    time: nowSec(),
    uptime: Math.round(process.uptime()),
  };
}

// -------------------- 请求处理 --------------------
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/api/health') return sendJson(res, 200, { ok: true, ...health() });

  if (pathname.startsWith('/api/')) {
    const matched = matchRoute(req.method, pathname);
    if (!matched) {
      return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `接口不存在：${req.method} ${pathname}` } });
    }
    if (matched.methodMismatch) {
      return sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不被支持' } });
    }
    const { route, params } = matched;
    assertSameOrigin(req);

    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies[SESSION_COOKIE] || '';
    let user = null;

    if (route.guard !== OPEN) {
      if (!isInitialized(db)) {
        return sendJson(res, 428, {
          ok: false,
          error: { code: 'SETUP_REQUIRED', message: '系统尚未初始化，请先创建管理员账号' },
        });
      }
      user = userFromToken(db, token);
      if (!user) return sendError(res, unauthorized());
    }

    if (route.guard === ADMIN && user.role !== 'admin') {
      return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: '仅管理员可执行该操作' } });
    }

    let body = {};
    if (!['GET', 'HEAD', 'DELETE'].includes(req.method)) {
      body = await readJson(req, 16 * 1024 * 1024);
    }

    const query = Object.fromEntries(url.searchParams.entries());
    const ctx = { db, config, req, res, params, query, body, user, token };
    const result = await route.handler(ctx);
    if (result === undefined) return; // 处理函数已自行响应
    return sendJson(res, 200, { ok: true, ...result });
  }

  if (pathname.startsWith('/uploads/')) {
    const rel = path.normalize(pathname.replace('/uploads/', '')).replace(/^([/\\])+/, '');
    if (rel.includes('..')) return sendJson(res, 400, { ok: false, error: { code: 'BAD_PATH', message: '非法路径' } });
    const user = userFromToken(db, parseCookies(req.headers.cookie || '')[SESSION_COOKIE] || '');
    if (!user) return sendJson(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: '请先登录' } });
    return serveStatic(config.uploadDir, rel, res);
  }

  return serveStatic(config.publicDir, pathname, res);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    sendError(res, err instanceof HttpError ? err : err);
  });
});

server.listen(config.port, config.host, () => {
  const initialized = isInitialized(db);
  const siteName = getSetting(db, 'site_name', '年轮');
  console.log('');
  console.log(`  ${siteName} · Nianlun v${config.version}`);
  console.log(`  ├─ 监听地址   http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  console.log(`  ├─ 数据目录   ${config.dataDir}`);
  console.log(`  └─ 初始化状态 ${initialized ? '已完成' : '未完成（首次访问将进入管理员创建向导）'}`);
  console.log('');
  if (!initialized) {
    console.log('  ⚠ 首次启动：请在浏览器打开上面的地址，创建管理员账号。');
    console.log('');
  }
});

const purge = setInterval(() => {
  try {
    purgeExpiredSessions(db);
  } catch (err) {
    console.error('[年轮] 清理过期会话失败：', err.message);
  }
}, 3600 * 1000);
purge.unref?.();

function shutdown(signal) {
  console.log(`\n[年轮] 收到 ${signal}，正在关闭…`);
  server.close(() => {
    try {
      db.close();
    } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { server, db, config };
