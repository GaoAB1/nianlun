// HTTP 工具层：Cookie、请求体解析、响应、静态资源
import fs from 'node:fs';
import path from 'node:path';

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function serializeCookie(name, value, opts = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge !== undefined) bits.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  bits.push(`Path=${opts.path || '/'}`);
  if (opts.httpOnly !== false) bits.push('HttpOnly');
  bits.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.secure) bits.push('Secure');
  return bits.join('; ');
}

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || `HTTP_${status}`;
  }
}

export function badRequest(message, code) {
  return new HttpError(400, message, code || 'BAD_REQUEST');
}
export function unauthorized(message = '请先登录') {
  return new HttpError(401, message, 'UNAUTHORIZED');
}
export function forbidden(message = '没有权限执行该操作') {
  return new HttpError(403, message, 'FORBIDDEN');
}
export function notFound(message = '资源不存在') {
  return new HttpError(404, message, 'NOT_FOUND');
}
export function conflict(message, code) {
  return new HttpError(409, message, code || 'CONFLICT');
}

export function readBody(req, maxBytes = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new HttpError(413, '请求体过大', 'PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, maxBytes) {
  const buf = await readBody(req, maxBytes);
  if (!buf.length) return {};
  try {
    const data = JSON.parse(buf.toString('utf8'));
    if (data === null || typeof data !== 'object') throw new Error('not object');
    return data;
  } catch {
    throw badRequest('请求体不是合法的 JSON');
  }
}

export function sendJson(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function sendError(res, err) {
  const status =
    err instanceof HttpError ? err.status : Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  const isKnown = err instanceof HttpError || (Number.isInteger(err?.status) && err.status < 500);
  const message = isKnown ? err.message : '服务器内部错误';
  const code = isKnown ? err.code || `HTTP_${status}` : 'INTERNAL_ERROR';
  if (!isKnown) console.error('[年轮] 请求处理失败：', err);
  sendJson(res, status, { ok: false, error: { code, message } });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** 静态资源服务；未命中的无扩展名路径回落到 index.html（SPA） */
export function serveStatic(rootDir, urlPath, res) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const rel = path.normalize(clean).replace(/^([/\\])+/, '');
  if (rel.includes('..')) {
    sendJson(res, 400, { ok: false, error: { code: 'BAD_PATH', message: '非法路径' } });
    return;
  }
  let file = path.join(rootDir, rel || 'index.html');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(rel)) {
      sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '资源不存在' } });
      return;
    }
    file = path.join(rootDir, 'index.html');
  }
  if (!fs.existsSync(file)) {
    sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '前端资源缺失' } });
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const isHtml = ext === '.html';
  const stat = fs.statSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=3600',
  });
  fs.createReadStream(file).pipe(res);
}

/** 针对写操作做轻量 CSRF 防护：校验 Origin/Host 一致 */
export function assertSameOrigin(req) {
  const method = req.method || 'GET';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const origin = req.headers.origin;
  if (!origin) return; // 同源表单/命令行工具不带 Origin，放行
  try {
    const o = new URL(origin);
    const host = String(req.headers.host || '');
    if (o.host !== host) throw forbidden('跨站请求已被拒绝');
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw forbidden('非法请求来源');
  }
}
