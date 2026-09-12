// 鉴权：scrypt 密码哈希 + Cookie 会话（零依赖）
import crypto from 'node:crypto';
import { nowSec, plain } from './db.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_TTL = 30 * 24 * 3600; // 30 天
export const SESSION_COOKIE = 'nl_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltHex, hashHex] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createSession(db, userId, userAgent = '') {
  const token = crypto.randomBytes(32).toString('base64url');
  const ts = nowSec();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)').run(
    token,
    userId,
    ts,
    ts + SESSION_TTL,
    String(userAgent).slice(0, 255)
  );
  return { token, expiresAt: ts + SESSION_TTL, maxAge: SESSION_TTL };
}

export function destroySession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function destroyUserSessions(db, userId, exceptToken = null) {
  if (exceptToken) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(userId, exceptToken);
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

export function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowSec());
}

/** 依据会话 token 取出用户；无效则返回 null */
export function userFromToken(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.*, s.expires_at, s.token
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`
    )
    .get(token);
  if (!row) return null;
  if (Number(row.expires_at) < nowSec()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  const user = plain(row);
  if (user.status !== 'active') return null;
  delete user.password_hash;
  return user;
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    status: user.status,
    avatarColor: user.avatar_color,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at ?? null,
    isAdmin: user.role === 'admin',
  };
}

export const USERNAME_RE = /^[A-Za-z0-9_.\-]{3,32}$/;

export function validatePassword(password) {
  if (typeof password !== 'string') return '密码格式不正确';
  if (password.length < 8) return '密码至少 8 位';
  if (password.length > 128) return '密码不能超过 128 位';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return '密码需同时包含字母和数字';
  return null;
}
