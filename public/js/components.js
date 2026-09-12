// 界面范式组件：环形进度 / 点阵热力图 / 圆点日历 / 折线趋势 / 环形分布
// 以及底部弹层、对话框、操作菜单
import { $, dayToDate, dayShort, daysInMonth, esc, humanDuration, icon, monthLabel, todayKey, weekdayLabels } from './util.js';

const COLORS = ['#5B9BF3', '#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#BA7517', '#378ADD', '#639922', '#0F6E56', '#993C1D'];

export const palette = COLORS;
export const seriesColor = (i) => COLORS[i % COLORS.length];

/** 依据数值归一化成 0–4 档，供点阵/热力图着色 */
export function levelsOf(counts, max) {
  const peak = Math.max(1, max ?? Math.max(0, ...Object.values(counts)));
  const out = {};
  for (const [k, v] of Object.entries(counts)) {
    out[k] = v <= 0 ? 0 : v >= peak ? 4 : Math.max(1, Math.ceil((v / peak) * 4));
  }
  return out;
}

// ---------------------------------------------------------------- 环形进度
/**
 * 刻度圆环：复刻 NoteMark 的计时器与目标进度环
 * @param {{size?:number, stroke?:number, progress?:number, color?:string,
 *          ticks?:boolean, center?:string}} o
 */
export function ring(o = {}) {
  const size = o.size ?? 180;
  const stroke = o.stroke ?? 11;
  const progress = Math.max(0, Math.min(1, o.progress ?? 0));
  const color = o.color || 'var(--brand)';
  const gap = o.ticks ? 16 : 6;
  const r = size / 2 - stroke / 2 - gap;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.round(progress * 100);

  let tickMarkup = '';
  if (o.ticks) {
    const n = 60;
    const inner = r + stroke / 2 + 4;
    const outer = inner + 6;
    const arc = (2 * Math.PI * n) / 12;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const filled = i / n <= progress;
      const len = i % 5 === 0 ? outer : outer - 2.4;
      const x1 = c + Math.cos(a) * inner;
      const y1 = c + Math.sin(a) * inner;
      const x2 = c + Math.cos(a) * len;
      const y2 = c + Math.sin(a) * len;
      tickMarkup += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
        stroke="${filled ? color : 'var(--surface-3)'}" stroke-width="${i % 5 === 0 ? 2 : 1.4}" stroke-linecap="round"/>`;
      void arc;
    }
  }

  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="完成度 ${pct}%">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${stroke}"/>
      ${progress > 0 ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${(circ * progress).toFixed(2)} ${circ.toFixed(2)}"/>` : ''}
      ${tickMarkup}
    </svg>
    <div class="ring-label">${o.center ?? `<div><div class="ring-percent">${pct}%</div></div>`}</div>
  </div>`;
}

// ---------------------------------------------------------------- 三指标行
export function metricsRow(stats, opts = {}) {
  const items = [
    { value: stats.total, label: '次数' },
    { value: stats.days, label: '天数' },
    { value: stats.streak, label: '连续' },
  ];
  if (opts.withGap && stats.avgGap) items.push({ value: stats.avgGap, label: '平均间隔' });
  return `<div class="metrics">${items
    .map(
      (m) =>
        `<div class="metric"><div class="metric-value">${m.value}${opts.unit ? `<small>${esc(opts.unit)}</small>` : ''}</div><div class="metric-label">${m.label}</div></div>`
    )
    .join('')}</div>`;
}

// ---------------------------------------------------------------- 月点阵（卡片内）
export function monthMatrix({ month, counts = {}, today = todayKey(), weekStartsOn = 1 }) {
  const total = daysInMonth(month);
  const first = `${month}-01`;
  const offset = (dayToDate(first).getDay() - weekStartsOn + 7) % 7;
  const levels = levelsOf(counts);
  const head = weekdayLabels(weekStartsOn)
    .map((w) => `<span class="month-cell" style="background:transparent;color:var(--text-3)">${w}</span>`)
    .join('');
  let cells = '';
  for (let i = 0; i < offset; i += 1) cells += '<span class="month-cell" style="background:transparent"></span>';
  for (let d = 1; d <= total; d += 1) {
    const key = `${month}-${String(d).padStart(2, '0')}`;
    const lv = levels[key] || 0;
    const cls = ['month-cell', lv ? 'has' : '', lv ? `l${lv}` : '', key === today ? 'today' : ''].filter(Boolean).join(' ');
    cells += `<span class="${cls}" title="${key}${counts[key] ? ` · ${counts[key]} 次` : ''}">${d}</span>`;
  }
  return `<div class="month-grid">${head}${cells}</div>`;
}

// ---------------------------------------------------------------- 年热力图
export function heatmapYear({ year, counts = {}, today = todayKey(), weekStartsOn = 1 }) {
  const levels = levelsOf(counts);
  const totalEntries = Object.values(counts).reduce((s, v) => s + v, 0);
  const totalDays = Object.values(counts).filter((v) => v > 0).length;

  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    const month = `${year}-${String(m).padStart(2, '0')}`;
    const total = daysInMonth(month);
    const offset = (dayToDate(`${month}-01`).getDay() - weekStartsOn + 7) % 7;
    let cells = '';
    for (let i = 0; i < offset; i += 1) cells += '<span class="heat-cell" style="background:transparent"></span>';
    for (let d = 1; d <= total; d += 1) {
      const key = `${month}-${String(d).padStart(2, '0')}`;
      const lv = levels[key] || 0;
      const cls = ['heat-cell', lv ? `l${lv}` : '', key === today ? 'today' : ''].filter(Boolean).join(' ');
      cells += `<span class="${cls}" title="${key}${counts[key] ? ` · ${counts[key]}` : ''}"></span>`;
    }
    months.push(`<div><div class="heat-month-name">${m} 月</div><div class="heat-grid">${cells}</div></div>`);
  }

  return `
  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px">
    <div>
      <div style="font-size:15px;font-weight:600;letter-spacing:-.01em">${year} 年 · 累计记录 ${totalDays} 天</div>
      <div style="font-size:12px;color:var(--text-3);margin-top:2px">共 ${totalEntries} 条记录</div>
    </div>
    <div class="heat-legend">
      <span>少</span>
      <i style="background:var(--surface-3)"></i>
      <i style="background:color-mix(in srgb, var(--brand) 26%, transparent)"></i>
      <i style="background:color-mix(in srgb, var(--brand) 45%, transparent)"></i>
      <i style="background:color-mix(in srgb, var(--brand) 68%, transparent)"></i>
      <i style="background:var(--brand)"></i>
      <span>多</span>
    </div>
  </div>
  <div class="heat-months">${months.join('')}</div>`;
}

// ---------------------------------------------------------------- 圆点日历
export function dotCalendar({ month, counts = {}, today = todayKey(), weekStartsOn = 1, onPick }) {
  const total = daysInMonth(month);
  const offset = (dayToDate(`${month}-01`).getDay() - weekStartsOn + 7) % 7;
  const levels = levelsOf(counts);
  const head = weekdayLabels(weekStartsOn).map((w) => `<div class="dot-cal-head">${w}</div>`).join('');
  let cells = '';
  for (let i = 0; i < offset; i += 1) cells += '<div class="dot-cal-cell"></div>';
  for (let d = 1; d <= total; d += 1) {
    const key = `${month}-${String(d).padStart(2, '0')}`;
    const lv = levels[key] || 0;
    const cls = ['dot-cal-dot', lv ? 'has' : '', lv > 2 ? `l${lv}` : '', key === today ? 'today' : ''].filter(Boolean).join(' ');
    cells += `<div class="dot-cal-cell"><button class="${cls}" data-day="${key}" ${onPick ? '' : 'tabindex="-1"'} title="${key}${counts[key] ? ` · ${counts[key]} 次` : ''}">${d}</button></div>`;
  }
  return `<div class="dot-cal">${head}${cells}</div>`;
}

// ---------------------------------------------------------------- 折线趋势
export function trendChart(points, opts = {}) {
  const w = 640;
  const h = 150;
  const pad = 6;
  if (!points.length) return '<div class="empty" style="padding:24px">暂无数据</div>';
  const max = Math.max(1, ...points.map((p) => p.count));
  const stepX = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const y = (v) => h - pad - (v / max) * (h - pad * 2 - 12);

  const coords = points.map((p, i) => [pad + i * stepX, y(p.count)]);
  const line = coords.map(([x, yy], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${yy.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)} ${h - pad} L${coords[0][0].toFixed(1)} ${h - pad} Z`;
  const gridLines = [0.25, 0.5, 0.75]
    .map((f) => `<line x1="${pad}" x2="${w - pad}" y1="${(h - pad - f * (h - pad * 2 - 12)).toFixed(1)}" y2="${(h - pad - f * (h - pad * 2 - 12)).toFixed(1)}" stroke="var(--hair)" stroke-width="1"/>`)
    .join('');

  const dots = coords
    .map(([x, yy], i) =>
      points[i].count
        ? `<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="3" fill="var(--brand)"><title>${points[i].day}：${points[i].count}</title></circle>`
        : ''
    )
    .join('');

  const first = points[0]?.day ?? '';
  const last = points[points.length - 1]?.day ?? '';
  return `
  <svg class="trend" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="记录趋势折线图">
    <defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--brand)" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="var(--brand)" stop-opacity="0"/>
    </linearGradient></defs>
    ${gridLines}
    <path d="${area}" fill="url(#trendFill)" stroke="none"/>
    <path d="${line}" fill="none" stroke="var(--brand)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
  </svg>
  <div class="trend-legend"><span>${esc(first)}</span><span>${opts.label || ''}</span><span>${esc(last)}</span></div>`;
}

// ---------------------------------------------------------------- 环形分布
export function donut(items, opts = {}) {
  const size = opts.size ?? 168;
  const stroke = opts.stroke ?? 26;
  const r = size / 2 - stroke / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const total = items.reduce((s, i) => s + Number(i.count || 0), 0);

  if (!total) {
    return `<div class="donut" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${stroke}"/></svg>
      <div class="donut-center"><div><div class="ring-percent">0</div><div class="ring-sub">条记录</div></div></div>
    </div>`;
  }

  let acc = 0;
  const segs = items
    .map((it) => {
      const frac = Number(it.count) / total;
      // 100% 时不要用 dasharray，否则部分渲染器会在起点留一道发丝缝
      if (frac >= 0.9995) {
        acc += frac;
        return `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${it.color}" stroke-width="${stroke}"><title>${esc(it.name)} · ${it.count} 条</title></circle>`;
      }
      const dash = frac * circ;
      const seg = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${it.color}"
        stroke-width="${stroke}" stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}"
        stroke-dashoffset="${(-acc * circ).toFixed(2)}" stroke-linecap="butt"><title>${esc(it.name)} · ${it.count} 条</title></circle>`;
      acc += frac;
      return seg;
    })
    .join('');

  return `<div class="donut" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)" role="img" aria-label="占比环形图">
      ${segs}
    </svg>
    <div class="donut-center"><div><div class="ring-percent">${total}</div><div class="ring-sub">条记录</div></div></div>
  </div>`;
}

export function legend(items) {
  return items
    .map(
      (it) => `<div class="legend-row">
        <span class="legend-dot" style="background:${it.color}"></span>
        <span class="legend-name">${esc(it.name)}</span>
        <span class="legend-val">${it.count} 条 · ${it.percent ?? 0}%</span>
      </div>`
    )
    .join('');
}

export function donutBlock(items) {
  return `<div class="donut-wrap">${donut(items)}<div class="donut-legend">${legend(items)}</div></div>`;
}

// ---------------------------------------------------------------- 空状态
export function emptyState({ iconName = 'sparkle', title, text, actionLabel, action = '' }) {
  return `<div class="empty">
    <div class="empty-icon">${icon(iconName, 'i i-28')}</div>
    <div class="empty-title">${esc(title)}</div>
    <div class="empty-text">${esc(text)}</div>
    ${actionLabel ? `<button class="btn btn-primary" data-act="${action}">${icon('plus', 'i i-18')}${esc(actionLabel)}</button>` : ''}
  </div>`;
}

export function avatar(user, cls = '') {
  const name = user?.displayName || user?.username || '?';
  const ch = [...name][0] || '?';
  const color = user?.avatarColor || 'var(--brand)';
  return `<span class="avatar ${cls}" style="background:${color}">${esc(ch)}</span>`;
}

// ---------------------------------------------------------------- 弹层
let layerEl;
function ensureLayer() {
  layerEl = $('#layer');
  return layerEl;
}

export function sheet({ title, body, footer, wide = false, onMount, dismissible = true }) {
  const root = ensureLayer();
  closeSheet();
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'active-overlay';
  overlay.innerHTML = `<div class="sheet" ${wide ? 'style="max-width:720px"' : ''}>
    <div class="sheet-grip"></div>
    <div class="sheet-head">
      <div class="sheet-title">${esc(title)}</div>
      <button class="icon-btn" data-close aria-label="关闭">${icon('x')}</button>
    </div>
    <div class="sheet-body">${body}</div>
    ${footer ? `<div class="sheet-foot">${footer}</div>` : ''}
  </div>`;
  root.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('on'));
  const close = () => closeSheet();
  overlay.querySelector('[data-close]').addEventListener('click', close);
  if (dismissible) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }
  onMount?.(overlay.querySelector('.sheet'), close);
  return overlay.querySelector('.sheet');
}

export function closeSheet() {
  const overlay = $('#active-overlay');
  if (!overlay) return;
  overlay.classList.remove('on');
  setTimeout(() => overlay.remove(), 280);
}

export function dialog({ title, text, body = '', confirmText = '确定', cancelText = '取消', danger = false, onConfirm }) {
  const root = ensureLayer();
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.style.alignItems = 'center';
  overlay.innerHTML = `<div class="dialog">
    <div class="dialog-title">${esc(title)}</div>
    ${text ? `<div class="dialog-text">${esc(text)}</div>` : ''}
    ${body}
    <div class="dialog-actions">
      <button class="btn btn-ghost" data-cancel>${esc(cancelText)}</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmText)}</button>
    </div>
  </div>`;
  root.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('on'));
  const done = () => {
    overlay.classList.remove('on');
    setTimeout(() => overlay.remove(), 260);
  };
  overlay.querySelector('[data-cancel]').addEventListener('click', done);
  overlay.querySelector('[data-ok]').addEventListener('click', async () => {
    if (onConfirm) {
      const ok = await onConfirm();
      if (ok === false) return;
    }
    done();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) done();
  });
  return overlay;
}

export function confirmDelete({ title, text, confirmText = '删除', onConfirm }) {
  return dialog({ title, text, confirmText, danger: true, onConfirm });
}

/** 长按/点击更多 → 弹出操作菜单 */
export function openMenu(anchor, items) {
  $$menuClose();
  const rect = anchor.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.id = 'active-menu';
  menu.innerHTML = items
    .map((it, i) => `<button data-mi="${i}" class="${it.danger ? 'danger' : ''}">${icon(it.icon, 'i i-18')}<span>${esc(it.label)}</span></button>`)
    .join('');
  document.body.appendChild(menu);

  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = Math.min(Math.max(10, rect.right - mw), window.innerWidth - mw - 10);
  let top = rect.bottom + 6;
  if (top + mh > window.innerHeight - 10) top = Math.max(10, rect.top - mh - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mi]');
    if (!btn) return;
    const item = items[Number(btn.dataset.mi)];
    $$menuClose();
    item.onSelect?.();
  });
  setTimeout(() => {
    document.addEventListener('click', outside);
    window.addEventListener('scroll', $$menuClose, { once: true, passive: true });
  }, 0);
  function outside(e) {
    if (!menu.contains(e.target)) $$menuClose();
  }
  function cleanup() {
    document.removeEventListener('click', outside);
  }
  menu._cleanup = cleanup;
}

export function $$menuClose() {
  const m = document.getElementById('active-menu');
  if (m) {
    m._cleanup?.();
    m.remove();
  }
}

/** 通用「填写数值」表单片段 */
export function fieldRow(label, control, hint = '') {
  return `<label class="field"><span class="field-label">${esc(label)}</span>${control}${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}</label>`;
}

export function durationStat(seconds) {
  return seconds > 0 ? humanDuration(seconds) : '';
}

export function todayLabel() {
  const t = todayKey();
  return `${monthLabel(t.slice(0, 7))} ${dayShort(t)}`;
}
