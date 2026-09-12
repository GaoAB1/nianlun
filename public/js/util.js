// 通用工具：DOM 辅助、日期、格式化、提示
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function icon(name, cls = 'i') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#ic-${name}"></use></svg>`;
}

/** 事件委托 */
export function on(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

// ---------------- 日期 ----------------
export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  return Math.round((dayToDate(a) - dayToDate(b)) / 86400000);
}
export function monthKey(key) {
  return key.slice(0, 7);
}
export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
export function startOfWeekKey(key, weekStartsOn = 1) {
  const dow = dayToDate(key).getDay();
  return shiftDay(key, -((dow - weekStartsOn + 7) % 7));
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const weekdayLabels = (weekStartsOn = 1) => [0, 1, 2, 3, 4, 5, 6].map((i) => WEEK[(i + weekStartsOn) % 7].replace('周', ''));
export const weekdayName = (key) => WEEK[dayToDate(key).getDay()];

export function dayLabel(key, today = todayKey()) {
  const d = diffDays(key, today);
  if (d === 0) return '今天';
  if (d === -1) return '昨天';
  if (d === -2) return '前天';
  if (d === 1) return '明天';
  const date = dayToDate(key);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${weekdayName(key)}`;
}
export function dayShort(key) {
  const d = dayToDate(key);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${y} 年 ${m} 月`;
}
export function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts) * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function fmtClock(ts) {
  const d = new Date(Number(ts) * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function fmtDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
export function humanDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.round(s / 60)} 分钟`;
  return `${(s / 3600).toFixed(1)} 小时`;
}
export function relativeTime(ts) {
  const diff = Math.floor(Date.now() / 1000) - Number(ts || 0);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return fmtDateTime(ts).slice(0, 10);
}

// ---------------- 提示 ----------------
export function toast(message, type = '') {
  const box = $('#toasts');
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.innerHTML = `${type === 'err' ? icon('x', 'i i-18') : type === 'ok' ? icon('check', 'i i-18') : ''}<span>${esc(message)}</span>`;
  box.appendChild(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 240);
  }, 2600);
}

export function debounce(fn, wait = 260) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/** 压缩图片为 dataURL，避免上传过大 */
export function readImageAsDataUrl(file, maxSize = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('请选择图片文件'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解析失败'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
