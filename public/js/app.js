// 应用外壳、状态与哈希路由
import { api, onSetupRequired, onUnauthorized } from './api.js';
import { $, icon, todayKey, toast } from './util.js';
import { pageShell } from './shell.js';
import * as Auth from './views/auth.js';
import * as Home from './views/home.js';
import * as Timeline from './views/timeline.js';
import * as Insights from './views/insights.js';
import * as Manage from './views/manage.js';
import * as Settings from './views/settings.js';
import * as Record from './views/record.js';

const ROUTES = {
  '#/home': Home,
  '#/timeline': Timeline,
  '#/insights': Insights,
  '#/manage': Manage,
  '#/settings': Settings,
};

const LS = { theme: 'nianlun.theme', weekStart: 'nianlun.weekStart', group: 'nianlun.group' };

const state = {
  config: { siteName: '年轮', initialized: false },
  user: null,
  groups: [],
  templates: [],
  tags: [],
  activeGroup: localStorage.getItem(LS.group) || 'all',
  weekStartsOn: localStorage.getItem(LS.weekStart) === '0' ? 0 : 1,
  theme: localStorage.getItem(LS.theme) || 'light',
  today: todayKey(),
  route: '#/home',
};

let viewRoot = null;
let hashBound = false;

function applyTheme(theme) {
  const resolved = theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0e0e10' : '#f5f5f7');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.theme === 'auto') applyTheme('auto');
});

export const ctx = {
  state,
  api,
  get user() {
    return state.user;
  },
  setUser(user) {
    state.user = user;
  },
  go(hash) {
    if (location.hash === hash) renderRoute();
    else location.hash = hash;
  },
  render: () => renderRoute(),
  async loadTemplates() {
    const [tpl, grp] = await Promise.all([
      api.get(`/api/templates?today=${state.today}&weekStartsOn=${state.weekStartsOn}`),
      api.get('/api/groups'),
    ]);
    state.templates = tpl.templates || [];
    state.groups = grp.groups || [];
    return state.templates;
  },
  async loadTags() {
    const res = await api.get('/api/tags');
    state.tags = res.tags || [];
    return state.tags;
  },
  setWeekStart(n) {
    state.weekStartsOn = n === 0 ? 0 : 1;
    localStorage.setItem(LS.weekStart, String(state.weekStartsOn));
  },
  setTheme(t) {
    state.theme = t;
    localStorage.setItem(LS.theme, t);
    applyTheme(t);
  },
  setActiveGroup(g) {
    state.activeGroup = g;
    localStorage.setItem(LS.group, g);
  },
  refreshToday() {
    state.today = todayKey();
  },
  openRecord: (template) => Record.openRecordSheet(ctx, template),
  openTimer: (template) => Record.openTimerSheet(ctx, template),
  signIn: (user, config) => signedIn(user, config),
};

function showBoot(mode) {
  viewRoot.hidden = false;
  document.getElementById('boot')?.remove();
  if (mode === 'auth') return;
}

// ---------------------------------------------------------------- 渲染
function errorPage(err, active) {
  return pageShell(state, {
    title: '出错了',
    active,
    body: `<div class="empty"><div class="empty-icon">${icon('x', 'i i-28')}</div>
      <div class="empty-title">页面加载失败</div>
      <div class="empty-text">${err.message || '未知错误'}</div>
      <button class="btn btn-primary" data-act="retry-page">重新加载</button></div>`,
  });
}

async function renderRoute() {
  const hash = location.hash || '#/home';
  state.route = hash;
  if (!state.user || !viewRoot) return;

  const key = hash.split('?')[0];
  const route = ROUTES[key];
  if (!route) {
    ctx.go('#/home');
    return;
  }

  ctx.refreshToday();

  if (key !== '#/settings') {
    try {
      await ctx.loadTemplates();
    } catch (err) {
      if (err.status === 401) return;
    }
  }

  try {
    await route.render(viewRoot, ctx, { active: key });
  } catch (err) {
    if (err.status === 401) return;
    console.error(err);
    viewRoot.innerHTML = errorPage(err, key);
    viewRoot.querySelector('[data-act="retry-page"]')?.addEventListener('click', () => renderRoute());
  }

  bindShellActions();
  window.scrollTo(0, 0);
}

function bindShellActions() {
  viewRoot.querySelectorAll('[data-act="account"]').forEach((el) => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', () => Settings.openAccountSheet(ctx));
  });
}

// 全局委托：底部“记一笔”快捷入口
document.addEventListener('click', (e) => {
  const fab = e.target.closest('[data-act="quick-add"]');
  if (!fab) return;
  e.preventDefault();
  if (!state.user) return;
  Record.openPickerSheet(ctx);
});

// ---------------------------------------------------------------- 鉴权流转
onUnauthorized(() => {
  state.user = null;
  if (!viewRoot) return;
  showBoot('auth');
  Auth.renderLogin(viewRoot, ctx);
});

onSetupRequired(() => {
  if (!state.user && viewRoot) Auth.renderSetup(viewRoot, ctx);
});

async function bootstrap() {
  viewRoot = $('#view');
  applyTheme(state.theme);

  try {
    state.config = await api.setupStatus();
  } catch {
    viewRoot.hidden = false;
    document.getElementById('boot')?.remove();
    viewRoot.innerHTML = `<div class="auth"><div class="auth-panel">
      <div class="auth-mark">${icon('x', 'i i-28')}</div>
      <div class="auth-title">无法连接服务</div>
      <div class="auth-sub">请确认年轮服务正在运行，然后刷新页面重试。</div>
      <div class="auth-form"><button class="btn btn-primary btn-block btn-lg" data-act="reload">重新加载</button></div>
    </div></div>`;
    viewRoot.querySelector('[data-act="reload"]')?.addEventListener('click', () => location.reload());
    return;
  }

  viewRoot.hidden = false;
  document.getElementById('boot')?.remove();

  // 首次启动：强制创建管理员
  if (!state.config.initialized) {
    Auth.renderSetup(viewRoot, ctx);
    return;
  }

  try {
    const res = await api.me();
    state.user = res.user;
  } catch {
    Auth.renderLogin(viewRoot, ctx);
    return;
  }

  if (!location.hash) location.hash = '#/home';
  await renderRoute();
  bindHashRouter();
}

function bindHashRouter() {
  if (hashBound) return;
  hashBound = true;
  window.addEventListener('hashchange', () => {
    if (!state.user) return;
    renderRoute();
  });
}

/** 登录或初始化成功后进入应用 */
export async function signedIn(user, config) {
  state.user = user;
  if (config) state.config = { ...state.config, ...config };
  state.config.initialized = true;
  if (!location.hash || location.hash === '#/login') location.hash = '#/home';
  viewRoot.hidden = false;
  document.getElementById('boot')?.remove();
  await renderRoute();
  bindHashRouter();
}

export async function reloadAll() {
  try {
    await Promise.all([ctx.loadTemplates(), ctx.loadTags()]);
  } catch (err) {
    if (err.status !== 401) toast(err.message, 'err');
  }
}

bootstrap();
