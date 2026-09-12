// 初始化、登录、会话、用户管理
import {
  SESSION_COOKIE,
  USERNAME_RE,
  createSession,
  destroySession,
  destroyUserSessions,
  hashPassword,
  publicUser,
  validatePassword,
  verifyPassword,
} from '../auth.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unauthorized } from '../http.js';
import { isInitialized, nowSec, plain, setSetting, getSetting } from '../db.js';
import { STARTER_TEMPLATES } from '../seed.js';

const AVATAR_COLORS = ['#5B9BF3', '#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#BA7517', '#378ADD', '#639922'];

// ---------- 登录失败限流（内存态，重启即清空） ----------
const attempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW = 10 * 60;

function throttleKey(req, username) {
  return `${req.socket?.remoteAddress || 'unknown'}|${String(username).toLowerCase()}`;
}
function assertNotThrottled(key) {
  const rec = attempts.get(key);
  if (!rec) return;
  if (nowSec() - rec.first > WINDOW) {
    attempts.delete(key);
    return;
  }
  if (rec.count >= MAX_ATTEMPTS) {
    throw new HttpError(429, '尝试次数过多，请 10 分钟后再试', 'TOO_MANY_ATTEMPTS');
  }
}
function noteFailure(key) {
  const rec = attempts.get(key);
  if (!rec || nowSec() - rec.first > WINDOW) attempts.set(key, { count: 1, first: nowSec() });
  else rec.count += 1;
}
function clearFailures(key) {
  attempts.delete(key);
}

function setSessionCookie(res, session) {
  const secure = process.env.COOKIE_SECURE === '1';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${session.token}; Max-Age=${session.maxAge}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
}

function pickAvatarColor(seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function normalizeUsername(raw) {
  const username = String(raw ?? '').trim();
  if (!USERNAME_RE.test(username)) {
    throw badRequest('用户名需为 3–32 位，仅允许字母、数字、下划线、点或短横线');
  }
  return username;
}

function createUserRecord(db, { username, password, displayName, role = 'member' }) {
  const ts = nowSec();
  const info = db
    .prepare(
      `INSERT INTO users (username, display_name, password_hash, role, status, avatar_color, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
    )
    .run(
      username,
      displayName || username,
      hashPassword(password),
      role,
      pickAvatarColor(username),
      ts,
      ts
    );
  return Number(info.lastInsertRowid);
}

function seedForUser(db, userId) {
  const ts = nowSec();
  const groupIds = new Map();
  for (const [index, name] of ['健康', '学习', '生活'].entries()) {
    const info = db
      .prepare('INSERT INTO groups (user_id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, name, AVATAR_COLORS[index], index, ts);
    groupIds.set(name, Number(info.lastInsertRowid));
  }
  for (const [index, tpl] of STARTER_TEMPLATES.entries()) {
    db.prepare(
      `INSERT INTO templates (user_id, group_id, name, emoji, color, mode, description, fields, goal_value, goal_period, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      groupIds.get(tpl.group) ?? null,
      tpl.name,
      tpl.emoji,
      tpl.color,
      tpl.mode,
      tpl.description ?? '',
      JSON.stringify(tpl.fields ?? []),
      tpl.goalValue ?? 0,
      tpl.goalPeriod ?? 'month',
      index,
      ts,
      ts
    );
  }
}

// ---------- 路由处理 ----------

export function setupStatus(ctx) {
  const db = ctx.db;
  return {
    initialized: isInitialized(db),
    siteName: getSetting(db, 'site_name', '年轮'),
    allowRegistration: getSetting(db, 'allow_registration', '0') === '1',
  };
}

export function createAdmin(ctx) {
  const db = ctx.db;
  if (isInitialized(db)) throw conflict('系统已完成初始化，无法重复创建管理员', 'ALREADY_INITIALIZED');

  const username = normalizeUsername(ctx.body.username);
  const passwordError = validatePassword(ctx.body.password);
  if (passwordError) throw badRequest(passwordError);

  const userId = createUserRecord(db, {
    username,
    password: ctx.body.password,
    displayName: String(ctx.body.displayName || username).slice(0, 40),
    role: 'admin',
  });

  if (ctx.body.seedTemplates !== false) seedForUser(db, userId);

  setSetting(db, 'initialized', '1');
  setSetting(db, 'initialized_at', nowSec());
  if (ctx.body.siteName) setSetting(db, 'site_name', String(ctx.body.siteName).slice(0, 40));

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const session = createSession(db, userId, ctx.req.headers['user-agent'] || '');
  setSessionCookie(ctx.res, session);
  console.log(`[年轮] 初始化完成，管理员账号：${username}`);
  return { user: publicUser(plain(user)), session: { expiresAt: session.expiresAt } };
}

export function login(ctx) {
  const db = ctx.db;
  const username = String(ctx.body.username ?? '').trim();
  const password = String(ctx.body.password ?? '');
  if (!username || !password) throw badRequest('请填写用户名和密码');

  const key = throttleKey(ctx.req, username);
  assertNotThrottled(key);

  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row || !verifyPassword(password, row.password_hash)) {
    noteFailure(key);
    throw unauthorized('用户名或密码不正确');
  }
  if (row.status !== 'active') throw forbidden('该账号已被禁用，请联系管理员');

  clearFailures(key);
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowSec(), row.id);
  const session = createSession(db, row.id, ctx.req.headers['user-agent'] || '');
  setSessionCookie(ctx.res, session);
  const user = plain(db.prepare('SELECT * FROM users WHERE id = ?').get(row.id));
  return { user: publicUser(user), session: { expiresAt: session.expiresAt } };
}

export function logout(ctx) {
  destroySession(ctx.db, ctx.token);
  clearSessionCookie(ctx.res);
  return { ok: true };
}

export function me(ctx) {
  return { user: publicUser(ctx.user) };
}

export function changeOwnPassword(ctx) {
  const db = ctx.db;
  const current = String(ctx.body.currentPassword ?? '');
  const next = String(ctx.body.newPassword ?? '');
  const row = plain(db.prepare('SELECT password_hash FROM users WHERE id = ?').get(ctx.user.id));
  if (!row || !verifyPassword(current, row.password_hash)) throw badRequest('当前密码不正确');
  const err = validatePassword(next);
  if (err) throw badRequest(err);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(next),
    nowSec(),
    ctx.user.id
  );
  destroyUserSessions(db, ctx.user.id, ctx.token);
  return { ok: true };
}

export function updateOwnProfile(ctx) {
  const db = ctx.db;
  const displayName = String(ctx.body.displayName ?? '').trim().slice(0, 40);
  const avatarColor = /^#[0-9A-Fa-f]{6}$/.test(ctx.body.avatarColor || '') ? ctx.body.avatarColor : null;
  db.prepare(
    `UPDATE users
        SET display_name  = COALESCE(NULLIF(?, ''), display_name),
            avatar_color  = COALESCE(?, avatar_color),
            updated_at    = ?
      WHERE id = ?`
  ).run(displayName, avatarColor, nowSec(), ctx.user.id);
  const user = plain(db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id));
  return { user: publicUser(user) };
}

export function listUsers(ctx) {
  const rows = ctx.db
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM templates t WHERE t.user_id = u.id) AS template_count,
              (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id) AS entry_count
         FROM users u ORDER BY u.id ASC`
    )
    .all();
  return {
    users: rows.map((r) => ({
      ...publicUser({ ...r }),
      templateCount: Number(r.template_count ?? 0),
      entryCount: Number(r.entry_count ?? 0),
    })),
    initialized: isInitialized(ctx.db),
  };
}

export function createUser(ctx) {
  const db = ctx.db;
  const username = normalizeUsername(ctx.body.username);
  const passwordError = validatePassword(ctx.body.password);
  if (passwordError) throw badRequest(passwordError);
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    throw conflict('该用户名已被占用', 'USERNAME_TAKEN');
  }
  const role = ctx.body.role === 'admin' ? 'admin' : 'member';
  const userId = createUserRecord(db, {
    username,
    password: ctx.body.password,
    displayName: String(ctx.body.displayName || '').slice(0, 40),
    role,
  });
  if (ctx.body.seedTemplates) seedForUser(db, userId);
  const row = plain(db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
  return { user: publicUser(row) };
}

export function patchUser(ctx) {
  const db = ctx.db;
  const id = Number(ctx.params.id);
  const row = plain(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  if (!row) throw notFound('用户不存在');

  const isSelf = id === ctx.user.id;
  const fields = [];
  const args = [];

  if (ctx.body.displayName !== undefined) {
    fields.push('display_name = ?');
    args.push(String(ctx.body.displayName).slice(0, 40));
  }
  if (ctx.body.status !== undefined) {
    const status = ctx.body.status === 'disabled' ? 'disabled' : 'active';
    if (isSelf && status === 'disabled') throw badRequest('不能禁用当前登录的账号');
    fields.push('status = ?');
    args.push(status);
  }
  if (ctx.body.role !== undefined) {
    const role = ctx.body.role === 'admin' ? 'admin' : 'member';
    if (isSelf && role !== 'admin') throw badRequest('不能取消自己的管理员权限');
    if (row.role === 'admin' && role !== 'admin') assertNotLastAdmin(db, id);
    fields.push('role = ?');
    args.push(role);
  }
  if (ctx.body.avatarColor !== undefined && /^#[0-9A-Fa-f]{6}$/.test(ctx.body.avatarColor)) {
    fields.push('avatar_color = ?');
    args.push(ctx.body.avatarColor);
  }
  if (!fields.length) throw badRequest('没有需要更新的字段');

  fields.push('updated_at = ?');
  args.push(nowSec(), id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...args);

  if (ctx.body.status === 'disabled') destroyUserSessions(db, id);
  const updated = plain(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  return { user: publicUser(updated) };
}

export function resetUserPassword(ctx) {
  const db = ctx.db;
  const id = Number(ctx.params.id);
  const row = plain(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  if (!row) throw notFound('用户不存在');
  const err = validatePassword(ctx.body.newPassword);
  if (err) throw badRequest(err);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(ctx.body.newPassword),
    nowSec(),
    id
  );
  destroyUserSessions(db, id, id === ctx.user.id ? ctx.token : null);
  return { ok: true };
}

export function removeUser(ctx) {
  const db = ctx.db;
  const id = Number(ctx.params.id);
  if (id === ctx.user.id) throw badRequest('不能删除当前登录的账号');
  const row = plain(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  if (!row) throw notFound('用户不存在');
  if (row.role === 'admin') assertNotLastAdmin(db, id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return { ok: true, removedUsername: row.username };
}

function assertNotLastAdmin(db, excludeId) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND id <> ?").get(excludeId);
  if (Number(row?.n ?? 0) === 0) throw badRequest('系统至少需要保留一个管理员');
}

/** 管理员可改的站点级设置 */
export function updateSettings(ctx) {
  const db = ctx.db;
  if (ctx.body.siteName !== undefined) {
    const name = String(ctx.body.siteName).trim().slice(0, 20);
    if (!name) throw badRequest('站点名称不能为空');
    setSetting(db, 'site_name', name);
  }
  if (ctx.body.allowRegistration !== undefined) {
    setSetting(db, 'allow_registration', ctx.body.allowRegistration ? '1' : '0');
  }
  return {
    siteName: getSetting(db, 'site_name', '年轮'),
    allowRegistration: getSetting(db, 'allow_registration', '0') === '1',
  };
}

/** 首次启动的引导数据：预设模板，降低「空模板列表」的起步门槛 */
export { seedForUser };
