// 业务数据：分组 / 模板 / 记录 / 标签 / 图片上传
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { badRequest, notFound } from '../http.js';
import { decodeEntry, decodeTemplate, nowSec, plain, plainAll } from '../db.js';
import { assertDayKey, computeStreak, diffDays, periodRange, shiftDay, todayKey } from '../dates.js';

const FIELD_TYPES = new Set(['text', 'number', 'select', 'rating', 'image']);
const PERIODS = new Set(['day', 'week', 'month', 'year', 'all']);
const HEX = /^#[0-9A-Fa-f]{6}$/;

function requireName(raw, label) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw badRequest(`${label}不能为空`);
  if ([...name].length > 24) throw badRequest(`${label}不能超过 24 个字`);
  return name;
}

function sanitizeColor(raw, fallback = '#5B9BF3') {
  return HEX.test(raw || '') ? raw : fallback;
}

function sanitizeEmoji(raw, fallback = '📌') {
  const s = String(raw ?? '').trim();
  if (!s) return fallback;
  return [...s].slice(0, 2).join('');
}

/** 校验并净化模板的字段定义 */
export function sanitizeFields(raw) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw badRequest('字段定义必须是数组');
  if (raw.length > 12) throw badRequest('单个模板最多 12 个字段');
  const seen = new Set();
  return raw.map((f, i) => {
    const label = String(f?.label ?? '').trim().slice(0, 20) || `字段${i + 1}`;
    let key = String(f?.key ?? '').trim().replace(/[^A-Za-z0-9_]/g, '');
    if (!key) key = `f${i + 1}`;
    while (seen.has(key)) key = `${key}_`;
    seen.add(key);
    const type = FIELD_TYPES.has(f?.type) ? f.type : 'text';
    const out = { key, label, type };
    if (type === 'number') {
      if (f.unit) out.unit = String(f.unit).slice(0, 8);
      if (f.placeholder) out.placeholder = String(f.placeholder).slice(0, 24);
    }
    if (type === 'text' && f.placeholder) out.placeholder = String(f.placeholder).slice(0, 40);
    if (type === 'select') {
      const options = (Array.isArray(f.options) ? f.options : [])
        .map((o) => String(o).trim().slice(0, 16))
        .filter(Boolean)
        .slice(0, 12);
      if (!options.length) throw badRequest(`字段「${label}」至少需要一个选项`);
      out.options = options;
    }
    if (type === 'rating') {
      const max = Number(f.max);
      out.max = Number.isFinite(max) ? Math.min(10, Math.max(3, Math.round(max))) : 5;
    }
    return out;
  });
}

// ---------------- 分组 ----------------

export function listGroups(ctx) {
  const rows = plainAll(ctx.db.prepare('SELECT * FROM groups WHERE user_id = ? ORDER BY sort_order ASC, id ASC').all(ctx.user.id));
  const counts = plainAll(
    ctx.db
      .prepare('SELECT group_id, COUNT(*) AS n FROM templates WHERE user_id = ? AND archived = 0 GROUP BY group_id')
      .all(ctx.user.id)
  );
  const map = new Map(counts.map((c) => [c.group_id, Number(c.n)]));
  return { groups: rows.map((g) => ({ ...g, templateCount: map.get(g.id) ?? 0 })) };
}

export function createGroup(ctx) {
  const name = requireName(ctx.body.name, '分组名称');
  const db = ctx.db;
  const exists = db.prepare('SELECT 1 FROM groups WHERE user_id = ? AND name = ?').get(ctx.user.id, name);
  if (exists) throw badRequest('已存在同名分组');
  const max = plain(db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM groups WHERE user_id = ?').get(ctx.user.id));
  const info = db
    .prepare('INSERT INTO groups (user_id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ctx.user.id, name, sanitizeColor(ctx.body.color), Number(max.m) + 1, nowSec());
  const row = plain(db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(info.lastInsertRowid)));
  return { group: { ...row, templateCount: 0 } };
}

export function patchGroup(ctx) {
  const db = ctx.db;
  const id = Number(ctx.params.id);
  const row = plain(db.prepare('SELECT * FROM groups WHERE id = ? AND user_id = ?').get(id, ctx.user.id));
  if (!row) throw notFound('分组不存在');
  const fields = [];
  const args = [];
  if (ctx.body.name !== undefined) {
    const name = requireName(ctx.body.name, '分组名称');
    const dup = db.prepare('SELECT 1 FROM groups WHERE user_id = ? AND name = ? AND id <> ?').get(ctx.user.id, name, id);
    if (dup) throw badRequest('已存在同名分组');
    fields.push('name = ?');
    args.push(name);
  }
  if (ctx.body.color !== undefined) {
    fields.push('color = ?');
    args.push(sanitizeColor(ctx.body.color, row.color));
  }
  if (ctx.body.sortOrder !== undefined) {
    fields.push('sort_order = ?');
    args.push(Number(ctx.body.sortOrder) || 0);
  }
  if (!fields.length) throw badRequest('没有需要更新的字段');
  args.push(id, ctx.user.id);
  db.prepare(`UPDATE groups SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...args);
  return { group: plain(db.prepare('SELECT * FROM groups WHERE id = ?').get(id)) };
}

export function removeGroup(ctx) {
  const id = Number(ctx.params.id);
  const row = plain(ctx.db.prepare('SELECT * FROM groups WHERE id = ? AND user_id = ?').get(id, ctx.user.id));
  if (!row) throw notFound('分组不存在');
  ctx.db.prepare('DELETE FROM groups WHERE id = ? AND user_id = ?').run(id, ctx.user.id);
  return { ok: true };
}

export function reorderGroups(ctx) {
  const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids : [];
  const stmt = ctx.db.prepare('UPDATE groups SET sort_order = ? WHERE id = ? AND user_id = ?');
  ids.forEach((id, index) => stmt.run(index, Number(id), ctx.user.id));
  return listGroups(ctx);
}

// ---------------- 模板 ----------------

function loadStatsMap(db, userId) {
  const rows = plainAll(
    db.prepare('SELECT template_id, day_key, COUNT(*) AS n FROM entries WHERE user_id = ? GROUP BY template_id, day_key').all(userId)
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.template_id)) map.set(r.template_id, []);
    map.get(r.template_id).push({ day: r.day_key, count: Number(r.n) });
  }
  return map;
}

function summarize(template, dayRows, today, weekStartsOn) {
  const days = dayRows.map((r) => r.day);
  const total = dayRows.reduce((sum, r) => sum + r.count, 0);
  const range = periodRange(template.goal_period || 'month', today, weekStartsOn);
  const goalCount = dayRows.filter((r) => r.day >= range.from && r.day <= range.to).reduce((s, r) => s + r.count, 0);
  const lastAt = days.length ? days.reduce((a, b) => (a > b ? a : b)) : null;

  const monthFrom = `${today.slice(0, 7)}-01`;
  const monthDays = {};
  for (const r of dayRows) if (r.day >= monthFrom) monthDays[r.day] = r.count;

  const sorted = [...days].sort().reverse();
  const avgGap = sorted.length > 1 ? (diffDays(sorted[0], sorted[sorted.length - 1]) / (sorted.length - 1)) : 0;

  return {
    total,
    days: days.length,
    streak: computeStreak(days, today),
    goal: {
      value: template.goal_value,
      period: template.goal_period,
      count: goalCount,
      from: range.from,
      to: range.to,
      percent: template.goal_value > 0 ? Math.min(100, Math.round((goalCount / template.goal_value) * 100)) : null,
    },
    firstDay: days.length ? sorted[sorted.length - 1] : null,
    lastDay: lastAt,
    avgGap: Math.round(avgGap * 10) / 10,
    monthDays,
  };
}

export function listTemplates(ctx) {
  const db = ctx.db;
  const today = ctx.query.today && /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.today) ? ctx.query.today : todayKey();
  const weekStartsOn = Number(ctx.query.weekStartsOn) === 0 ? 0 : 1;
  const includeArchived = ctx.query.archived === '1';
  const rows = plainAll(
    db
      .prepare(
        `SELECT * FROM templates WHERE user_id = ? ${includeArchived ? '' : 'AND archived = 0'} ORDER BY sort_order ASC, id ASC`
      )
      .all(ctx.user.id)
  ).map(decodeTemplate);
  const statsMap = loadStatsMap(db, ctx.user.id);
  return {
    today,
    templates: rows.map((t) => ({ ...t, stats: summarize(t, statsMap.get(t.id) ?? [], today, weekStartsOn) })),
  };
}

export function getTemplate(ctx) {
  const db = ctx.db;
  const id = Number(ctx.params.id);
  const row = plain(db.prepare('SELECT * FROM templates WHERE id = ? AND user_id = ?').get(id, ctx.user.id));
  if (!row) throw notFound('模板不存在');
  const template = decodeTemplate(row);
  const today = ctx.query.today && /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.today) ? ctx.query.today : todayKey();
  const days = plainAll(
    db.prepare('SELECT day_key, COUNT(*) AS n FROM entries WHERE template_id = ? GROUP BY day_key').all(id)
  ).map((r) => ({ day: r.day_key, count: Number(r.n) }));
  return { template: { ...template, stats: summarize(template, days, today, Number(ctx.query.weekStartsOn) === 0 ? 0 : 1) } };
}

function readTemplatePayload(ctx, existing = null) {
  const b = ctx.body;
  const out = {};
  if (existing === null || b.name !== undefined) out.name = requireName(b.name ?? existing?.name, '模板名称');
  if (existing === null || b.emoji !== undefined) out.emoji = sanitizeEmoji(b.emoji, existing?.emoji ?? '📌');
  if (existing === null || b.color !== undefined) out.color = sanitizeColor(b.color, existing?.color ?? '#5B9BF3');
  if (existing === null || b.mode !== undefined) out.mode = b.mode === 'record' ? 'record' : 'checkin';
  if (existing === null || b.description !== undefined) out.description = String(b.description ?? '').slice(0, 120);
  if (existing === null || b.fields !== undefined) out.fields = sanitizeFields(b.fields) ?? [];
  if (existing === null || b.goalValue !== undefined) {
    const v = Number(b.goalValue);
    out.goal_value = Number.isFinite(v) ? Math.min(9999, Math.max(0, Math.round(v))) : 0;
  }
  if (existing === null || b.goalPeriod !== undefined) {
    out.goal_period = PERIODS.has(b.goalPeriod) && b.goalPeriod !== 'all' ? b.goalPeriod : 'month';
  }
  if (existing === null || b.groupId !== undefined) {
    const gid = b.groupId === null || b.groupId === '' ? null : Number(b.groupId);
    if (gid !== null) {
      const g = ctx.db.prepare('SELECT 1 FROM groups WHERE id = ? AND user_id = ?').get(gid, ctx.user.id);
      if (!g) throw badRequest('指定的分组不存在');
    }
    out.group_id = gid;
  }
  if (existing === null || b.sortOrder !== undefined) out.sort_order = Number(b.sortOrder) || 0;
  if (existing === null || b.archived !== undefined) out.archived = b.archived ? 1 : 0;
  return out;
}

export function createTemplate(ctx) {
  const db = ctx.db;
  const data = readTemplatePayload(ctx);
  const max = plain(db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM templates WHERE user_id = ?').get(ctx.user.id));
  const ts = nowSec();
  const info = db
    .prepare(
      `INSERT INTO templates (user_id, group_id, name, emoji, color, mode, description, fields, goal_value, goal_period, sort_order, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(
      ctx.user.id,
      data.group_id ?? null,
      data.name,
      data.emoji,
      data.color,
      data.mode,
      data.description,
      JSON.stringify(data.fields),
      data.goal_value,
      data.goal_period,
      data.sort_order ?? Number(max.m) + 1,
      ts,
      ts
    );
  const row = plain(db.prepare('SELECT * FROM templates WHERE id = ?').get(Number(info.lastInsertRowid)));
  return { template: decodeTemplate(row) };
}

export function patchTemplate(ctx) {
  const db = ctx.db;
  const id = Number(ctx.params.id);
  const row = plain(db.prepare('SELECT * FROM templates WHERE id = ? AND user_id = ?').get(id, ctx.user.id));
  if (!row) throw notFound('模板不存在');
  const existing = decodeTemplate(row);
  const data = readTemplatePayload(ctx, existing);
  const keys = Object.keys(data);
  if (!keys.length) throw badRequest('没有需要更新的字段');
  const sets = keys.map((k) => `${k} = ?`);
  const args = keys.map((k) => (k === 'fields' ? JSON.stringify(data[k]) : data[k]));
  sets.push('updated_at = ?');
  args.push(nowSec(), id, ctx.user.id);
  db.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...args);
  const updated = plain(db.prepare('SELECT * FROM templates WHERE id = ?').get(id));
  return { template: decodeTemplate(updated) };
}

export function removeTemplate(ctx) {
  const db = ctx.db;
  const id = Number(ctx.params.id);
  const row = plain(db.prepare('SELECT * FROM templates WHERE id = ? AND user_id = ?').get(id, ctx.user.id));
  if (!row) throw notFound('模板不存在');
  const cnt = plain(db.prepare('SELECT COUNT(*) AS n FROM entries WHERE template_id = ?').get(id));
  db.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').run(id, ctx.user.id);
  return { ok: true, deletedTemplate: row.name, deletedEntries: Number(cnt.n) };
}

export function reorderTemplates(ctx) {
  const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids : [];
  const stmt = ctx.db.prepare('UPDATE templates SET sort_order = ? WHERE id = ? AND user_id = ?');
  ids.forEach((id, index) => stmt.run(index, Number(id), ctx.user.id));
  return listTemplates(ctx);
}

// ---------------- 记录 ----------------

function normalizeTags(raw, fallback = []) {
  if (raw === undefined) return fallback;
  if (!Array.isArray(raw)) throw badRequest('标签必须是数组');
  const seen = new Set();
  const out = [];
  for (const t of raw) {
    const tag = String(t ?? '').trim().replace(/^#/, '').slice(0, 16);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 8) break;
  }
  return out;
}

function sanitizeValues(template, raw) {
  const values = {};
  const input = raw && typeof raw === 'object' ? raw : {};
  for (const f of template.fields || []) {
    const v = input[f.key];
    if (v === undefined || v === null || v === '') continue;
    if (f.type === 'number') {
      const n = Number(v);
      if (Number.isFinite(n)) values[f.key] = Math.round(n * 100) / 100;
    } else if (f.type === 'rating') {
      const n = Number(v);
      if (Number.isFinite(n)) values[f.key] = Math.min(f.max || 5, Math.max(0, Math.round(n)));
    } else if (f.type === 'select') {
      const s = String(v);
      if (!f.options || f.options.includes(s)) values[f.key] = s;
    } else if (f.type === 'image') {
      const arr = Array.isArray(v) ? v : [v];
      values[f.key] = arr.map((x) => String(x)).filter((x) => x.startsWith('/uploads/')).slice(0, 6);
    } else {
      values[f.key] = String(v).slice(0, 500);
    }
  }
  return values;
}

export function listEntries(ctx) {
  const db = ctx.db;
  const limit = Math.min(200, Math.max(1, Number(ctx.query.limit) || 50));
  const offset = Math.max(0, Number(ctx.query.offset) || 0);
  const where = ['e.user_id = ?'];
  const args = [ctx.user.id];

  if (ctx.query.templateId) {
    where.push('e.template_id = ?');
    args.push(Number(ctx.query.templateId));
  }
  if (ctx.query.from && /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.from)) {
    where.push('e.day_key >= ?');
    args.push(ctx.query.from);
  }
  if (ctx.query.to && /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.to)) {
    where.push('e.day_key <= ?');
    args.push(ctx.query.to);
  }
  if (ctx.query.tag) {
    where.push('e.tags_json LIKE ?');
    args.push(`%"${String(ctx.query.tag).replace(/["%_]/g, '')}"%`);
  }
  if (ctx.query.q) {
    where.push('(e.note LIKE ? OR e.values_json LIKE ?)');
    const like = `%${String(ctx.query.q).slice(0, 40)}%`;
    args.push(like, like);
  }

  const sql = `SELECT e.*, t.name AS template_name, t.emoji AS template_emoji, t.color AS template_color
                 FROM entries e JOIN templates t ON t.id = e.template_id
                WHERE ${where.join(' AND ')}
                ORDER BY e.occurred_at DESC, e.id DESC
                LIMIT ? OFFSET ?`;
  const rows = plainAll(db.prepare(sql).all(...args, limit, offset));
  const totalRow = plain(db.prepare(`SELECT COUNT(*) AS n FROM entries e WHERE ${where.join(' AND ')}`).get(...args));

  const entries = rows.map((r) => ({
    ...decodeEntry(r),
    templateName: r.template_name,
    templateEmoji: r.template_emoji,
    templateColor: r.template_color,
  }));

  // 按日分组，便于时间线直接渲染
  const buckets = [];
  let current = null;
  for (const e of entries) {
    if (!current || current.day !== e.day_key) {
      current = { day: e.day_key, items: [] };
      buckets.push(current);
    }
    current.items.push(e);
  }
  return { entries, groups: buckets, total: Number(totalRow.n), limit, offset, hasMore: offset + entries.length < Number(totalRow.n) };
}

function loadOwnedTemplate(ctx, templateId) {
  const row = plain(ctx.db.prepare('SELECT * FROM templates WHERE id = ? AND user_id = ?').get(Number(templateId), ctx.user.id));
  if (!row) throw badRequest('记录模板不存在');
  return decodeTemplate(row);
}

export function createEntry(ctx) {
  const db = ctx.db;
  const template = loadOwnedTemplate(ctx, ctx.body.templateId);
  const day = ctx.body.day ? assertDayKey(ctx.body.day, '记录日期') : todayKey();
  const occurredAt = Number(ctx.body.occurredAt) || nowSec();
  const values = sanitizeValues(template, ctx.body.values);
  const tags = normalizeTags(ctx.body.tags);
  const duration = Math.max(0, Math.round(Number(ctx.body.duration) || 0));
  const ts = nowSec();
  const info = db
    .prepare(
      `INSERT INTO entries (user_id, template_id, occurred_at, day_key, values_json, note, tags_json, duration, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ctx.user.id,
      template.id,
      occurredAt,
      day,
      JSON.stringify(values),
      String(ctx.body.note ?? '').slice(0, 1000),
      JSON.stringify(tags),
      duration,
      ts,
      ts
    );
  const row = plain(db.prepare('SELECT * FROM entries WHERE id = ?').get(Number(info.lastInsertRowid)));
  return { entry: { ...decodeEntry(row), templateName: template.name, templateEmoji: template.emoji, templateColor: template.color } };
}

export function patchEntry(ctx) {
  const db = ctx.db;
  const id = Number(ctx.params.id);
  const row = plain(db.prepare('SELECT * FROM entries WHERE id = ? AND user_id = ?').get(id, ctx.user.id));
  if (!row) throw notFound('记录不存在');
  const entry = decodeEntry(row);
  const templateId = ctx.body.templateId !== undefined ? Number(ctx.body.templateId) : entry.template_id;
  const template = loadOwnedTemplate(ctx, templateId);

  const sets = [];
  const args = [];
  if (ctx.body.templateId !== undefined) {
    sets.push('template_id = ?');
    args.push(template.id);
  }
  if (ctx.body.day !== undefined) {
    sets.push('day_key = ?');
    args.push(assertDayKey(ctx.body.day, '记录日期'));
  }
  if (ctx.body.occurredAt !== undefined) {
    sets.push('occurred_at = ?');
    args.push(Number(ctx.body.occurredAt) || entry.occurred_at);
  }
  if (ctx.body.values !== undefined) {
    sets.push('values_json = ?');
    args.push(JSON.stringify(sanitizeValues(template, ctx.body.values)));
  }
  if (ctx.body.note !== undefined) {
    sets.push('note = ?');
    args.push(String(ctx.body.note ?? '').slice(0, 1000));
  }
  if (ctx.body.tags !== undefined) {
    sets.push('tags_json = ?');
    args.push(JSON.stringify(normalizeTags(ctx.body.tags, entry.tags)));
  }
  if (ctx.body.duration !== undefined) {
    sets.push('duration = ?');
    args.push(Math.max(0, Math.round(Number(ctx.body.duration) || 0)));
  }
  if (!sets.length) throw badRequest('没有需要更新的字段');
  sets.push('updated_at = ?');
  args.push(nowSec(), id, ctx.user.id);
  db.prepare(`UPDATE entries SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...args);
  const updated = plain(db.prepare('SELECT * FROM entries WHERE id = ?').get(id));
  return { entry: decodeEntry(updated) };
}

export function removeEntry(ctx) {
  const id = Number(ctx.params.id);
  const row = plain(ctx.db.prepare('SELECT id FROM entries WHERE id = ? AND user_id = ?').get(id, ctx.user.id));
  if (!row) throw notFound('记录不存在');
  ctx.db.prepare('DELETE FROM entries WHERE id = ? AND user_id = ?').run(id, ctx.user.id);
  return { ok: true };
}

export function listTags(ctx) {
  const db = ctx.db;
  const rows = plainAll(
    db
      .prepare(
        `SELECT e.tags_json, e.day_key, t.name AS tname
           FROM entries e JOIN templates t ON t.id = e.template_id
          WHERE e.user_id = ?`
      )
      .all(ctx.user.id)
  );
  const map = new Map();
  for (const r of rows) {
    let tags = [];
    try {
      tags = JSON.parse(r.tags_json);
    } catch {
      tags = [];
    }
    for (const tag of tags) {
      if (!map.has(tag)) map.set(tag, { name: tag, count: 0, days: new Set(), templates: new Set() });
      const rec = map.get(tag);
      rec.count += 1;
      rec.days.add(r.day_key);
      rec.templates.add(r.tname);
    }
  }
  const tags = [...map.values()]
    .map((t) => ({ name: t.name, count: t.count, days: t.days.size, templates: [...t.templates] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { tags };
}

// ---------------- 图片上传 ----------------

export async function uploadImage(ctx) {
  const dataUrl = String(ctx.body.dataUrl ?? '');
  const m = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw badRequest('图片格式不支持，请传入 base64 data URL');
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 4 * 1024 * 1024) throw badRequest('单张图片不能超过 4MB');
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const dir = path.join(ctx.config.uploadDir, String(ctx.user.id));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buf);
  return { url: `/uploads/${ctx.user.id}/${name}`, size: buf.length };
}
