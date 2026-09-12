// 端到端集成测试：初始化 / 鉴权 / 权限 / 模板 / 记录 / 统计 / 导入导出
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, serverArgs, freePort } from './helpers.mjs';

let PORT = 0;
let BASE = '';
let dataDir;
let child;

/** 启动测试专用服务实例 */
async function startServer() {
  PORT = await freePort();
  BASE = `http://127.0.0.1:${PORT}`;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nianlun-test-'));
  child = spawn(process.execPath, serverArgs(), {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function waitReady(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(`${BASE}/api/health`);
        if (r.ok) return resolve();
      } catch {}
      if (Date.now() > deadline) return reject(new Error('服务启动超时'));
      setTimeout(tick, 150);
    };
    tick();
  });
}

/** 带 Cookie 的请求封装 */
function makeClient() {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    clear() {
      cookie = '';
    },
    async req(method, url, body, { json = true } = {}) {
      const headers = {};
      if (cookie) headers.Cookie = cookie;
      let payload;
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      const res = await fetch(`${BASE}${url}`, { method, headers, body: payload });
      const setCookie = res.headers.getSetCookie?.() ?? [];
      for (const c of setCookie) {
        const kv = c.split(';')[0];
        if (kv.endsWith('=')) cookie = '';
        else cookie = kv;
      }
      const text = await res.text();
      let data = null;
      if (json && text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      return { status: res.status, data, text };
    },
  };
}

const admin = makeClient();
const member = makeClient();

async function api(client, method, url, body) {
  const res = await client.req(method, url, body);
  return res;
}

before(async () => {
  await startServer();

  let log = '';
  child.stdout.on('data', (d) => (log += d.toString()));
  child.stderr.on('data', (d) => (log += d.toString()));
  child.on('exit', (code) => {
    if (code) console.error('[测试] 服务异常退出', code, log);
  });
  await waitReady();
});

after(() => {
  child?.kill('SIGTERM');
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {}
});

test('健康检查返回版本与初始化状态', async () => {
  const res = await fetch(`${BASE}/api/health`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.initialized, false);
});

test('未初始化时业务接口返回 428 SETUP_REQUIRED', async () => {
  const res = await api(admin, 'GET', '/api/templates');
  assert.equal(res.data.error.code, 'SETUP_REQUIRED');
});

test('密码强度不足会被拒绝', async () => {
  const res = await api(admin, 'POST', '/api/setup/admin', { username: 'root', password: '12345678' });
  assert.equal(res.status, 400);
  assert.match(res.data.error.message, /字母和数字/);
});

test('用户名非法会被拒绝', async () => {
  const res = await api(admin, 'POST', '/api/setup/admin', { username: '管 理员', password: 'Passw0rd123' });
  assert.equal(res.status, 400);
});

test('首次启动创建管理员并自动登录、写入预设模板', async () => {
  const res = await api(admin, 'POST', '/api/setup/admin', {
    username: 'admin',
    password: 'Passw0rd123',
    displayName: '站长',
    siteName: '年轮',
    seedTemplates: true,
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.user.role, 'admin');
  assert.equal(res.data.user.isAdmin, true);
  assert.ok(admin.cookie.includes('nl_session='), '应下发会话 Cookie');

  const tpl = await api(admin, 'GET', '/api/templates');
  assert.equal(tpl.data.templates.length, 6);
  const groups = await api(admin, 'GET', '/api/groups');
  assert.equal(groups.data.groups.length, 3);
});

test('重复初始化被拒绝', async () => {
  const res = await api(admin, 'POST', '/api/setup/admin', { username: 'other', password: 'Passw0rd123' });
  assert.equal(res.status, 409);
  assert.equal(res.data.error.code, 'ALREADY_INITIALIZED');
});

test('初始化状态已翻转', async () => {
  const res = await api(admin, 'GET', '/api/setup/status');
  assert.equal(res.data.initialized, true);
  assert.equal(res.data.siteName, '年轮');
});

test('未登录访问受保护接口返回 401', async () => {
  const anon = makeClient();
  const res = await api(anon, 'GET', '/api/templates');
  assert.equal(res.status, 401);
});

test('登录：错误密码 401，正确密码 200', async () => {
  const bad = makeClient();
  const r1 = await api(bad, 'POST', '/api/auth/login', { username: 'admin', password: 'WrongPass123' });
  assert.equal(r1.status, 401);

  const good = makeClient();
  const r2 = await api(good, 'POST', '/api/auth/login', { username: 'admin', password: 'Passw0rd123' });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.user.username, 'admin');
  admin.clear();
  await api(admin, 'POST', '/api/auth/login', { username: 'admin', password: 'Passw0rd123' });
});

test('创建分组与自定义模板（含多类型字段）', async () => {
  const g = await api(admin, 'POST', '/api/groups', { name: '工作', color: '#D85A30' });
  assert.equal(g.status, 200);

  const t = await api(admin, 'POST', '/api/templates', {
    name: '深度工作',
    emoji: '🧠',
    color: '#7F77DD',
    mode: 'checkin',
    groupId: g.data.group.id,
    goalValue: 20,
    goalPeriod: 'month',
    fields: [
      { key: 'minutes', label: '时长', type: 'number', unit: '分钟' },
      { key: 'quality', label: '状态', type: 'select', options: ['专注', '一般', '走神'] },
      { key: 'score', label: '评分', type: 'rating', max: 5 },
      { key: 'note', label: '备注', type: 'text' },
    ],
  });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  assert.equal(t.data.template.fields.length, 4);
  assert.equal(t.data.template.group_id, g.data.group.id);

  // 非法选项被丢弃、非法数字被忽略
  const e = await api(admin, 'POST', '/api/entries', {
    templateId: t.data.template.id,
    day: '2026-09-12',
    note: '写完了核心模块',
    tags: ['#专注', '深度工作', '专注'],
    values: { minutes: 95, quality: '专注', score: 4, note: '顺利', evil: 'x', quality2: '不存在' },
  });
  assert.equal(e.status, 200, JSON.stringify(e.data));
  assert.equal(e.data.entry.values.minutes, 95);
  assert.equal(e.data.entry.values.evil, undefined);
  assert.deepEqual(e.data.entry.tags, ['专注', '深度工作']);
  assert.equal(e.data.entry.day_key, '2026-09-12');
});

test('模板统计：次数 / 天数 / 连续 / 目标进度', async () => {
  const tpl = await api(admin, 'GET', '/api/templates?today=2026-09-12');
  const dw = tpl.data.templates.find((t) => t.name === '深度工作');
  assert.equal(dw.stats.total, 1);
  assert.equal(dw.stats.days, 1);
  assert.equal(dw.stats.streak, 1);
  assert.equal(dw.stats.goal.count, 1);
  assert.equal(dw.stats.goal.percent, 5);
  assert.equal(dw.stats.monthDays['2026-09-12'], 1);
});

test('补打卡 + 连续天数跨日计算', async () => {
  const tpl = await api(admin, 'GET', '/api/templates');
  const run = tpl.data.templates.find((t) => t.name === '跑步');
  for (const day of ['2026-09-10', '2026-09-11', '2026-09-12']) {
    const r = await api(admin, 'POST', '/api/entries', { templateId: run.id, day, values: { distance: 5 }, tags: ['健身'] });
    assert.equal(r.status, 200);
  }
  const after = await api(admin, 'GET', '/api/templates?today=2026-09-12');
  const run2 = after.data.templates.find((t) => t.name === '跑步');
  assert.equal(run2.stats.total, 3);
  assert.equal(run2.stats.days, 3);
  assert.equal(run2.stats.streak, 3);
});

test('记录的增删改查与时间线分组', async () => {
  const created = await api(admin, 'POST', '/api/entries', {
    templateId: (await api(admin, 'GET', '/api/templates')).data.templates.find((t) => t.name === '心情').id,
    day: '2026-09-12',
    values: { mood: '很好', energy: 4 },
    note: '今天状态不错',
  });
  const id = created.data.entry.id;

  const patched = await api(admin, 'PATCH', `/api/entries/${id}`, { note: '改成更好', values: { mood: '还行', energy: 3 } });
  assert.equal(patched.data.entry.note, '改成更好');
  assert.equal(patched.data.entry.values.mood, '还行');

  const list = await api(admin, 'GET', '/api/entries?from=2026-09-12&to=2026-09-12');
  assert.ok(list.data.groups.length >= 1);
  assert.ok(list.data.entries.some((e) => e.id === id));
  assert.ok(list.data.entries.every((e) => e.templateName));

  const del = await api(admin, 'DELETE', `/api/entries/${id}`);
  assert.equal(del.data.ok, true);
  const list2 = await api(admin, 'GET', '/api/entries');
  assert.ok(!list2.data.entries.some((e) => e.id === id));
});

test('标签聚合统计', async () => {
  const res = await api(admin, 'GET', '/api/tags');
  const names = res.data.tags.map((t) => t.name);
  assert.ok(names.includes('健身'));
  assert.ok(names.includes('专注'));
  const gym = res.data.tags.find((t) => t.name === '健身');
  assert.equal(gym.count, 3);
  assert.equal(gym.days, 3);
  assert.deepEqual(gym.templates, ['跑步']);
});

test('洞察接口：概览 / 热力图 / 分布 / 趋势 / 标签统计', async () => {
  const q = 'today=2026-09-12';
  const overview = await api(admin, 'GET', `/api/stats/overview?${q}`);
  assert.equal(overview.status, 200);
  assert.equal(overview.data.stats.totalEntries, 4, '深度工作 1 + 跑步 3');
  assert.equal(overview.data.stats.streak, 3);
  assert.equal(overview.data.stats.todayCount, 2, '09-12 当天：深度工作 + 跑步');
  assert.equal(overview.data.stats.totalDays, 3);
  assert.ok(overview.data.stats.activeTemplates >= 7);

  const heat = await api(admin, 'GET', '/api/stats/heatmap?year=2026');
  assert.equal(heat.data.counts['2026-09-11'], 1);
  assert.equal(heat.data.counts['2026-09-12'], 2);
  assert.equal(heat.data.totalEntries, 4);
  assert.equal(heat.data.levels['2026-09-12'], 4, '当天为全年最大值，应落在最深一档');
  assert.equal(heat.data.levels['2026-09-11'], 2);

  const dist = await api(admin, 'GET', `/api/stats/distribution?period=month&${q}`);
  assert.ok(dist.data.items.length >= 2);
  const sum = dist.data.items.reduce((s, i) => s + i.count, 0);
  assert.equal(sum, dist.data.total);

  const trend = await api(admin, 'GET', `/api/stats/trend?period=month&${q}`);
  assert.equal(trend.data.granularity, 'day');
  assert.equal(trend.data.points.length, 30);

  const tagStats = await api(admin, 'GET', `/api/stats/tags?period=month&${q}`);
  assert.ok(tagStats.data.tags.some((t) => t.name === '健身' && t.templates.length === 1));
});

test('管理员创建普通用户，普通用户权限受限', async () => {
  const created = await api(admin, 'POST', '/api/users', {
    username: 'lisi',
    password: 'Lisi12345',
    displayName: '李四',
    role: 'member',
    seedTemplates: true,
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.user.role, 'member');

  const loginRes = await api(member, 'POST', '/api/auth/login', { username: 'lisi', password: 'Lisi12345' });
  assert.equal(loginRes.status, 200);

  const denied = await api(member, 'GET', '/api/users');
  assert.equal(denied.status, 403);

  const own = await api(member, 'GET', '/api/templates');
  assert.equal(own.data.templates.length, 6, '新用户应拿到独立的预设模板');
  assert.equal((await api(member, 'GET', '/api/entries')).data.total, 0, '数据应按用户隔离');

  const selfDisable = await api(admin, 'PATCH', `/api/users/${created.data.user.id}`, { status: 'disabled' });
  assert.equal(selfDisable.status, 200);
  const blocked = await api(member, 'GET', '/api/templates');
  assert.equal(blocked.status, 401, '被禁用用户的会话应立即失效');
});

test('不能删除自己、不能取消最后一个管理员', async () => {
  const me = await api(admin, 'GET', '/api/auth/me');
  const del = await api(admin, 'DELETE', `/api/users/${me.data.user.id}`);
  assert.equal(del.status, 400);
  const demote = await api(admin, 'PATCH', `/api/users/${me.data.user.id}`, { role: 'member' });
  assert.equal(demote.status, 400);
});

test('导出与导入（merge 模式）', async () => {
  const dump = await api(admin, 'GET', '/api/export');
  assert.equal(dump.data.format, 'nianlun-export');
  assert.ok(dump.data.templates.length >= 7);
  assert.ok(dump.data.entries.length >= 4);

  const beforeCount = (await api(admin, 'GET', '/api/entries')).data.total;
  const imp = await api(admin, 'POST', '/api/import', { ...dump.data, mode: 'merge' });
  assert.equal(imp.status, 200, JSON.stringify(imp.data));
  assert.ok(imp.data.createdTemplates >= 7);
  const afterCount = (await api(admin, 'GET', '/api/entries')).data.total;
  assert.equal(afterCount, beforeCount + dump.data.entries.length);

  const bad = await api(admin, 'POST', '/api/import', { nope: true });
  assert.equal(bad.status, 400);
});

test('修改密码后其他会话失效，新密码可登录', async () => {
  const second = makeClient();
  await api(second, 'POST', '/api/auth/login', { username: 'admin', password: 'Passw0rd123' });
  assert.equal((await api(second, 'GET', '/api/auth/me')).status, 200);

  const changed = await api(admin, 'POST', '/api/auth/password', {
    currentPassword: 'Passw0rd123',
    newPassword: 'Nianlun2026',
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal((await api(second, 'GET', '/api/auth/me')).status, 401, '同账号其他会话应被踢下线');
  assert.equal((await api(admin, 'GET', '/api/auth/me')).status, 200, '当前会话应保留');

  const re = makeClient();
  assert.equal((await api(re, 'POST', '/api/auth/login', { username: 'admin', password: 'Nianlun2026' })).status, 200);
});

test('登出后会话失效', async () => {
  const c = makeClient();
  await api(c, 'POST', '/api/auth/login', { username: 'admin', password: 'Nianlun2026' });
  assert.equal((await api(c, 'POST', '/api/auth/logout')).status, 200);
  assert.equal((await api(c, 'GET', '/api/auth/me')).status, 401);
});

test('未知接口返回 404，错误方法返回 405', async () => {
  const nf = await api(admin, 'GET', '/api/not-exist');
  assert.equal(nf.status, 404);
  const mm = await api(admin, 'PUT', '/api/entries');
  assert.equal(mm.status, 405);
});

test('参数校验：非法日期与越权模板访问', async () => {
  const badDate = await api(admin, 'POST', '/api/entries', {
    templateId: (await api(admin, 'GET', '/api/templates')).data.templates[0].id,
    day: '2026/09/12',
  });
  assert.equal(badDate.status, 400);

  const foreign = await api(admin, 'POST', '/api/entries', { templateId: 999999, day: '2026-09-12' });
  assert.equal(foreign.status, 400);
});
