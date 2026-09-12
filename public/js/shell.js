// 应用外壳：桌面侧边栏 + 顶部栏 + 移动端底部图标导航
// 单独成模块，避免 app.js 与各视图之间的循环依赖
import { esc, icon } from './util.js';

export const NAV = [
  { hash: '#/home', label: '今日', icon: 'home' },
  { hash: '#/timeline', label: '时间线', icon: 'timeline' },
  { hash: '#/insights', label: '洞察', icon: 'chart' },
  { hash: '#/manage', label: '模板', icon: 'grid' },
  { hash: '#/settings', label: '设置', icon: 'settings' },
];

function sidebar(state, active) {
  const u = state.user;
  const initial = [...(u?.displayName || u?.username || '?')][0] || '?';
  const links = NAV.map(
    (n) => `<a class="side-link ${n.hash === active ? 'on' : ''}" href="${n.hash}">${icon(n.icon, 'i i-18')}<span>${n.label}</span></a>`
  ).join('');
  return `<aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">${icon('sparkle', 'i i-18')}</div>
      <div>
        <div class="brand-name">${esc(state.config.siteName || '年轮')}</div>
        <div class="brand-sub">Nianlun</div>
      </div>
    </div>
    ${links}
    <div class="side-spacer"></div>
    <button class="side-user" data-act="account" type="button">
      <span class="avatar avatar-sm" style="background:${esc(u?.avatarColor || '#5B9BF3')}">${esc(initial)}</span>
      <span style="flex:1;min-width:0;text-align:left;display:block">
        <span style="display:block;font-size:13.5px;font-weight:500">${esc(u?.displayName || u?.username || '')}</span>
        <span style="display:block;font-size:11px;color:var(--text-3)">${u?.role === 'admin' ? '管理员' : '成员'}</span>
      </span>
    </button>
  </aside>`;
}

function tabbar(active) {
  const link = (n) => `<a class="${n.hash === active ? 'on' : ''}" href="${n.hash}" aria-label="${n.label}">${icon(n.icon)}</a>`;
  return `<nav class="tabbar">
    ${NAV.slice(0, 2).map(link).join('')}
    <a class="tabbar-fab" href="#/record" aria-label="记一笔" data-act="quick-add">${icon('plus', 'i i-28')}</a>
    ${NAV.slice(2).map(link).join('')}
  </nav>`;
}

export function pageShell(state, { title, subtitle = '', actions = '', active = '', body }) {
  return `${sidebar(state, active)}
  <header class="topbar">
    <div class="topbar-title">${esc(title)}${subtitle ? `<small>${esc(subtitle)}</small>` : ''}</div>
    <div class="topbar-actions">${actions}</div>
  </header>
  <main class="wrap">${body}</main>
  ${tabbar(active)}`;
}
