// 日期工具：统一用 YYYY-MM-DD 字符串（客户端本地日）做聚合键
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDayKey(s) {
  return typeof s === 'string' && DAY_RE.test(s);
}

export function assertDayKey(s, label = '日期') {
  if (!isValidDayKey(s)) {
    const err = new Error(`${label}格式应为 YYYY-MM-DD`);
    err.status = 400;
    err.code = 'BAD_DATE';
    throw err;
  }
  return s;
}

export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function dayToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function shiftDay(key, delta) {
  const d = dayToDate(key);
  d.setDate(d.getDate() + delta);
  return todayKey(d);
}

export function diffDays(a, b) {
  return Math.round((dayToDate(a).getTime() - dayToDate(b).getTime()) / 86400000);
}

export function startOfWeek(key, weekStartsOn = 1) {
  const d = dayToDate(key);
  const dow = d.getDay();
  const delta = (dow - weekStartsOn + 7) % 7;
  return shiftDay(key, -delta);
}

/** 返回某个周期对应的 [from, to] 日区间 */
export function periodRange(period, refKey, weekStartsOn = 1) {
  const d = dayToDate(refKey);
  switch (period) {
    case 'day':
      return { from: refKey, to: refKey };
    case 'week': {
      const from = startOfWeek(refKey, weekStartsOn);
      return { from, to: shiftDay(from, 6) };
    }
    case 'year': {
      const from = `${d.getFullYear()}-01-01`;
      return { from, to: `${d.getFullYear()}-12-31` };
    }
    case 'all':
      return { from: '1970-01-01', to: '2999-12-31' };
    case 'month':
    default: {
      const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      return { from, to: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
    }
  }
}

/** 由「已打卡的自然日集合」计算当前连续天数（允许今天尚未打卡） */
export function computeStreak(dayKeys, today) {
  const set = new Set(dayKeys);
  let cursor = set.has(today) ? today : shiftDay(today, -1);
  if (!set.has(cursor)) return 0;
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }
  return streak;
}

/** 生成 [from, to] 之间每一整天，按时间顺序 */
export function eachDay(from, to, maxDays = 400) {
  const out = [];
  let cursor = from;
  let guard = 0;
  while (diffDays(to, cursor) >= 0 && guard < maxDays) {
    out.push(cursor);
    cursor = shiftDay(cursor, 1);
    guard += 1;
  }
  return out;
}
