// 统计洞察：概览、热力图、分布、趋势、标签统计、数据导出导入
import { badRequest } from '../http.js';
import { decodeEntry, decodeTemplate, nowSec, plain, plainAll } from '../db.js';
import { computeStreak, eachDay, periodRange, shiftDay, todayKey } from '../dates.js';
import { sanitizeFields } from './data.js';

function resolveToday(query) {
  return query.today && /^\d{4}-\d{2}-\d{2}$/.test(query.today) ? query.today : todayKey();
}

function resolveWeekStart(query) {
  return Number(query.weekStartsOn) === 0 ? 0 : 1;
}

export function overview(ctx) {
  const db = ctx.db;
  const today = resolveToday(ctx.query);
  const weekStartsOn = resolveWeekStart(ctx.query);
  const rows = plainAll(
    db.prepare('SELECT day_key, COUNT(*) AS n FROM entries WHERE user_id = ? GROUP BY day_key').all(ctx.user.id)
  );
  const dayCounts = new Map(rows.map((r) => [r.day_key, Number(r.n)]));
  const days = [...dayCounts.keys()];
  const totalEntries = rows.reduce((s, r) => s + Number(r.n), 0);

  const week = periodRange('week', today, weekStartsOn);
  const month = periodRange('month', today, weekStartsOn);
  const year = periodRange('year', today, weekStartsOn);

  const sumIn = (r) => days.filter((d) => d >= r.from && d <= r.to).reduce((s, d) => s + (dayCounts.get(d) || 0), 0);

  const templates = plain(
    db.prepare('SELECT COUNT(*) AS n FROM templates WHERE user_id = ? AND archived = 0').get(ctx.user.id)
  );

  return {
    today,
    stats: {
      totalEntries,
      totalDays: days.length,
      todayCount: dayCounts.get(today) || 0,
      yesterdayCount: dayCounts.get(shiftDay(today, -1)) || 0,
      weekCount: sumIn(week),
      monthCount: sumIn(month),
      yearCount: sumIn(year),
      streak: computeStreak(days, today),
      activeTemplates: Number(templates?.n ?? 0),
      firstDay: days.length ? days.reduce((a, b) => (a < b ? a : b)) : null,
      weekRange: week,
      monthRange: month,
      yearRange: year,
    },
  };
}

export function heatmap(ctx) {
  const db = ctx.db;
  const year = Number(ctx.query.year) || Number(resolveToday(ctx.query).slice(0, 4));
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const rows = plainAll(
    db
      .prepare('SELECT day_key, COUNT(*) AS n FROM entries WHERE user_id = ? AND day_key BETWEEN ? AND ? GROUP BY day_key')
      .all(ctx.user.id, from, to)
  );
  const counts = {};
  for (const r of rows) counts[r.day_key] = Number(r.n);
  const totalEntries = rows.reduce((s, r) => s + Number(r.n), 0);
  return { year, from, to, counts, totalEntries, totalDays: rows.length, levels: buildLevels(counts) };
}

function buildLevels(counts) {
  const max = Math.max(1, ...Object.values(counts));
  const q = (v) => (v <= 0 ? 0 : v >= max ? 4 : Math.min(4, Math.ceil((v / max) * 4)));
  const out = {};
  for (const [k, v] of Object.entries(counts)) out[k] = q(v);
  return out;
}

export function distribution(ctx) {
  const db = ctx.db;
  const today = resolveToday(ctx.query);
  const range = ctx.query.period ? periodRange(ctx.query.period, today, resolveWeekStart(ctx.query)) : { from: ctx.query.from, to: ctx.query.to };
  const from = range.from || '1970-01-01';
  const to = range.to || '2999-12-31';
  const rows = plainAll(
    db
      .prepare(
        `SELECT t.id, t.name, t.emoji, t.color, COUNT(e.id) AS n
           FROM templates t LEFT JOIN entries e
             ON e.template_id = t.id AND e.day_key BETWEEN ? AND ?
          WHERE t.user_id = ?
          GROUP BY t.id ORDER BY n DESC, t.sort_order ASC`
      )
      .all(from, to, ctx.user.id)
  );
  const total = rows.reduce((s, r) => s + Number(r.n), 0);
  return {
    from,
    to,
    total,
    items: rows
      .filter((r) => Number(r.n) > 0)
      .map((r) => ({
        templateId: r.id,
        name: r.name,
        emoji: r.emoji,
        color: r.color,
        count: Number(r.n),
        percent: total ? Math.round((Number(r.n) / total) * 1000) / 10 : 0,
      })),
  };
}

export function trend(ctx) {
  const db = ctx.db;
  const today = resolveToday(ctx.query);
  const period = ctx.query.period || 'month';
  const range = periodRange(period === 'custom' ? 'month' : period, today, resolveWeekStart(ctx.query));
  const from = ctx.query.from && /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.from) ? ctx.query.from : range.from;
  const to = ctx.query.to && /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.to) ? ctx.query.to : range.to;

  const args = [ctx.user.id, from, to];
  let extra = '';
  if (ctx.query.templateId) {
    extra = ' AND template_id = ?';
    args.push(Number(ctx.query.templateId));
  }
  const rows = plainAll(
    db
      .prepare(`SELECT day_key, COUNT(*) AS n FROM entries WHERE user_id = ? AND day_key BETWEEN ? AND ?${extra} GROUP BY day_key`)
      .all(...args)
  );
  const map = new Map(rows.map((r) => [r.day_key, Number(r.n)]));
  const span = eachDay(from, to, 400);
  const points = span.map((day) => ({ day, count: map.get(day) || 0 }));

  // 长区间自动按周聚合，避免折线过密
  if (points.length > 120) {
    const weekly = [];
    for (let i = 0; i < points.length; i += 7) {
      const chunk = points.slice(i, i + 7);
      weekly.push({ day: chunk[0].day, count: chunk.reduce((s, p) => s + p.count, 0), end: chunk[chunk.length - 1].day });
    }
    return { from, to, granularity: 'week', points: weekly, total: weekly.reduce((s, p) => s + p.count, 0) };
  }
  return { from, to, granularity: 'day', points, total: points.reduce((s, p) => s + p.count, 0) };
}

export function templateCalendar(ctx) {
  const db = ctx.db;
  const id = Number(ctx.params.id);
  const template = plain(db.prepare('SELECT * FROM templates WHERE id = ? AND user_id = ?').get(id, ctx.user.id));
  if (!template) throw badRequest('模板不存在');
  const today = resolveToday(ctx.query);
  const month = ctx.query.month && /^\d{4}-\d{2}$/.test(ctx.query.month) ? ctx.query.month : today.slice(0, 7);
  const rows = plainAll(
    db
      .prepare('SELECT day_key, COUNT(*) AS n FROM entries WHERE template_id = ? AND day_key LIKE ? GROUP BY day_key')
      .all(id, `${month}-%`)
  );
  const counts = {};
  for (const r of rows) counts[r.day_key] = Number(r.n);
  return { month, counts, total: rows.reduce((s, r) => s + Number(r.n), 0) };
}

export function tagStats(ctx) {
  const db = ctx.db;
  const today = resolveToday(ctx.query);
  const period = ctx.query.period || 'month';
  const range = periodRange(period, today, resolveWeekStart(ctx.query));
  const rows = plainAll(
    db
      .prepare(
        `SELECT e.tags_json, e.day_key, t.id AS tid, t.name AS tname, t.emoji AS temoji, t.color AS tcolor
           FROM entries e JOIN templates t ON t.id = e.template_id
          WHERE e.user_id = ? AND e.day_key BETWEEN ? AND ?`
      )
      .all(ctx.user.id, range.from, range.to)
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
      if (!map.has(tag)) map.set(tag, { name: tag, count: 0, days: new Set(), templates: new Map(), firstDay: r.day_key, lastDay: r.day_key });
      const rec = map.get(tag);
      rec.count += 1;
      rec.days.add(r.day_key);
      rec.templates.set(r.tid, { id: r.tid, name: r.tname, emoji: r.temoji, color: r.tcolor, count: (rec.templates.get(r.tid)?.count || 0) + 1 });
      if (r.day_key < rec.firstDay) rec.firstDay = r.day_key;
      if (r.day_key > rec.lastDay) rec.lastDay = r.day_key;
    }
  }
  const tags = [...map.values()]
    .map((t) => {
      const templates = [...t.templates.values()];
      const total = templates.reduce((s, x) => s + x.count, 0) || 1;
      return {
        name: t.name,
        count: t.count,
        days: t.days.size,
        firstDay: t.firstDay,
        lastDay: t.lastDay,
        templates: templates
          .map((x) => ({ ...x, percent: Math.round((x.count / total) * 1000) / 10 }))
          .sort((a, b) => b.count - a.count),
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { period, from: range.from, to: range.to, tags };
}

// ---------------- 导出 / 导入 ----------------

export function exportData(ctx) {
  const db = ctx.db;
  const templates = plainAll(db.prepare('SELECT * FROM templates WHERE user_id = ? ORDER BY id').all(ctx.user.id)).map(decodeTemplate);
  const entries = plainAll(db.prepare('SELECT * FROM entries WHERE user_id = ? ORDER BY id').all(ctx.user.id)).map(decodeEntry);
  const groups = plainAll(db.prepare('SELECT * FROM groups WHERE user_id = ? ORDER BY id').all(ctx.user.id));
  return {
    format: 'nianlun-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    account: { username: ctx.user.username, displayName: ctx.user.display_name },
    groups: groups.map(({ user_id, ...g }) => g),
    templates: templates.map(({ user_id, ...t }) => t),
    entries: entries.map(({ user_id, ...e }) => e),
  };
}

export function importData(ctx) {
  const db = ctx.db;
  const payload = ctx.body;
  if (!payload || payload.format !== 'nianlun-export' || !Array.isArray(payload.templates)) {
    throw badRequest('导入文件格式不正确，需为年轮导出的 JSON');
  }
  const mode = payload.mode === 'replace' ? 'replace' : 'merge';
  const ts = nowSec();
  let createdTemplates = 0;
  let createdEntries = 0;

  const work = () => {
    if (mode === 'replace') {
      db.prepare('DELETE FROM templates WHERE user_id = ?').run(ctx.user.id);
      db.prepare('DELETE FROM groups WHERE user_id = ?').run(ctx.user.id);
    }

    const groupMap = new Map();
    for (const g of payload.groups || []) {
      const name = String(g.name ?? '').trim().slice(0, 24);
      if (!name) continue;
      const existing = plain(db.prepare('SELECT * FROM groups WHERE user_id = ? AND name = ?').get(ctx.user.id, name));
      if (existing) {
        groupMap.set(g.id, existing.id);
        continue;
      }
      const info = db
        .prepare('INSERT INTO groups (user_id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(ctx.user.id, name, String(g.color || '#5B9BF3'), Number(g.sort_order) || 0, ts);
      groupMap.set(g.id, Number(info.lastInsertRowid));
    }

    const templateMap = new Map();
    for (const t of payload.templates) {
      const name = String(t.name ?? '').trim().slice(0, 24);
      if (!name) continue;
      const fields = sanitizeFields(t.fields) ?? [];
      const info = db
        .prepare(
          `INSERT INTO templates (user_id, group_id, name, emoji, color, mode, description, fields, goal_value, goal_period, sort_order, archived, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          ctx.user.id,
          groupMap.get(t.group_id) ?? null,
          name,
          String(t.emoji || '📌').slice(0, 4),
          String(t.color || '#5B9BF3'),
          t.mode === 'record' ? 'record' : 'checkin',
          String(t.description || '').slice(0, 120),
          JSON.stringify(fields),
          Number(t.goal_value) || 0,
          ['day', 'week', 'month', 'year'].includes(t.goal_period) ? t.goal_period : 'month',
          Number(t.sort_order) || 0,
          t.archived ? 1 : 0,
          Number(t.created_at) || ts,
          ts
        );
      templateMap.set(t.id, Number(info.lastInsertRowid));
      createdTemplates += 1;
    }

    for (const e of payload.entries || []) {
      const templateId = templateMap.get(e.template_id);
      if (!templateId) continue;
      const day = /^\d{4}-\d{2}-\d{2}$/.test(e.day_key || '') ? e.day_key : todayKey();
      db.prepare(
        `INSERT INTO entries (user_id, template_id, occurred_at, day_key, values_json, note, tags_json, duration, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        ctx.user.id,
        templateId,
        Number(e.occurred_at) || ts,
        day,
        JSON.stringify(e.values || {}),
        String(e.note || '').slice(0, 1000),
        JSON.stringify(Array.isArray(e.tags) ? e.tags : []),
        Number(e.duration) || 0,
        Number(e.created_at) || ts,
        ts
      );
      createdEntries += 1;
    }
  };

  db.exec('BEGIN');
  try {
    work();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { ok: true, mode, createdTemplates, createdEntries };
}

export function clearData(ctx) {
  const db = ctx.db;
  if (ctx.body.confirm !== 'DELETE') throw badRequest('请传入 confirm="DELETE" 以确认清空');
  const scope = ctx.body.scope === 'all' ? 'all' : 'entries';
  if (scope === 'all') {
    db.prepare('DELETE FROM templates WHERE user_id = ?').run(ctx.user.id);
    db.prepare('DELETE FROM groups WHERE user_id = ?').run(ctx.user.id);
  } else {
    db.prepare('DELETE FROM entries WHERE user_id = ?').run(ctx.user.id);
  }
  return { ok: true, scope };
}
