// 真实浏览器端到端测试：用 Chrome DevTools Protocol 驱动 headless Chrome
// 覆盖首次启动初始化向导 → 打卡 → 各页面渲染 → 深色模式 → 桌面布局
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, serverArgs, freePort } from './helpers.mjs';

const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/snap/bin/chromium',
].find((p) => fs.existsSync(p));

const IS_LINUX = process.platform !== 'win32';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
const consoleErrors = [];
function ok(name, cond, extra = '') {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures.push(name);
}

/** Windows 上必须连子进程一起杀，否则临时 profile 目录删不掉 */
function killTree(proc) {
  if (!proc?.pid || proc.exitCode !== null) return;
  if (proc.pid === process.pid) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { stdio: 'ignore' });
    else proc.kill('SIGKILL');
  } catch {}
}

function rmQuiet(dir) {
  for (let i = 0; i < 6; i += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return true;
    } catch {
      // 文件仍被占用，稍后重试
      const end = Date.now() + 300;
      while (Date.now() < end) {
        /* 同步等待 */
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------- CDP 客户端
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        consoleErrors.push(d.exception?.description || d.text);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时：${method}`));
        }
      }, 20000);
    });
  }
  async eval(expr, awaitPromise = true) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    return res.result.value;
  }
  async waitFor(expr, label, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await this.eval(`!!(${expr})`)) return true;
      } catch {}
      await sleep(120);
    }
    throw new Error(`等待超时：${label}`);
  }
  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
  }
  async viewport(width, height, mobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile,
      screenWidth: width,
      screenHeight: height,
    });
  }
  async goto(hash = '') {
    // 用 replaceState + reload，保证即使 hash 相同也会真正重新加载并渲染
    await this.eval(
      `history.replaceState(null, '', ${JSON.stringify('__BASE__' + hash)}); location.reload(); true`
    ).catch(() => {});
    await sleep(900);
    await this.waitFor(`document.querySelector('#view') && !document.querySelector('#boot')`, '页面重载', 12000);
  }
}

// ---------------------------------------------------------------- 启动环境
const PORT = await freePort();
const CDP_PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = path.join(ROOT, 'data-ui');
fs.rmSync(dataDir, { recursive: true, force: true });
const profileDir = path.join(ROOT, '.chrome-profile');
fs.rmSync(profileDir, { recursive: true, force: true });

const server = spawn(process.execPath, serverArgs(), {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

for (let i = 0; i < 120; i += 1) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break;
  } catch {}
  await sleep(120);
}

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    ...(IS_LINUX ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] }
);
let chromeErr = '';
chrome.stderr.on('data', (d) => (chromeErr += d));

let wsUrl = null;
for (let i = 0; i < 100; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (page?.webSocketDebuggerUrl) {
      wsUrl = page.webSocketDebuggerUrl;
      break;
    }
  } catch {}
  await sleep(150);
}
if (!wsUrl) {
  console.error('无法连接 Chrome：', chromeErr.slice(-500));
  process.exit(1);
}

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res);
  ws.addEventListener('error', rej);
});
const cdp = new CDP(ws);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Log.enable');

const cleanup = async () => {
  try {
    // 先让浏览器自己优雅退出，避免 Windows 上残留文件句柄
    await cdp.send('Browser.close').catch(() => {});
  } catch {}
  await sleep(900);
  try {
    ws.close();
  } catch {}
  killTree(chrome);
  killTree(server);
  await sleep(900);
  rmQuiet(profileDir);
  rmQuiet(dataDir);
};

try {
  console.log('\n【1】首次启动必须走初始化向导');

  // 测试期间用 __BASE__ 占位符替换真实地址
  const origEval = cdp.eval.bind(cdp);
  cdp.eval = (expr, ap) => origEval(expr.replace(/__BASE__/g, BASE), ap);

  await cdp.viewport(430, 932, true);
  await cdp.send('Page.navigate', { url: BASE });
  await cdp.waitFor(`document.querySelector('.auth-panel')`, '初始化面板');

  const setupTitle = await cdp.eval(`document.querySelector('.auth-title').textContent.trim()`);
  ok('未初始化时直接进入创建管理员向导', setupTitle.includes('管理员'), setupTitle);

  const apiBlocked = await cdp.eval(`fetch('/api/templates').then(r=>r.status)`);
  ok('未初始化时业务接口被拦截（428）', apiBlocked === 428, `status=${apiBlocked}`);

  await cdp.shot('01-setup-step1');

  await cdp.eval(`
    const set = (n, v) => { const el = document.querySelector('[name="'+n+'"]'); el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); };
    set('siteName','年轮'); set('username','admin'); set('displayName','站长');
    set('password','Nianlun2026'); set('confirm','Nianlun2026');
    document.querySelector('[data-act="next"]').click(); true;
  `);
  await sleep(400);
  const step2 = await cdp.eval(`document.querySelector('.auth-title').textContent.trim()`);
  ok('第一步校验通过并进入第二步', step2.includes('模板'), step2);
  await cdp.shot('02-setup-step2');

  await cdp.eval(`document.querySelector('[data-act="submit"]').click(); true`);
  await cdp.waitFor(`document.querySelector('.tpl-card')`, '登录后进入首页', 15000);
  ok('初始化完成后自动登录并进入首页', true);

  const cardCount = await cdp.eval(`document.querySelectorAll('.tpl-card').length`);
  ok('预设模板渲染为卡片流', cardCount === 6, `${cardCount} 张卡片`);

  const hasHeat = await cdp.eval(`!!document.querySelector('.month-grid .month-cell')`);
  ok('卡片内含月点阵热力图', hasHeat);

  const hasMetrics = await cdp.eval(`document.querySelectorAll('.tpl-card .metrics .metric').length >= 3`);
  ok('卡片内含三指标数据行', hasMetrics);

  const hasRing = await cdp.eval(`!!document.querySelector('.tpl-card .ring svg')`);
  ok('卡片内含环形进度', hasRing);

  const tabbar = await cdp.eval(`document.querySelectorAll('.tabbar a').length`);
  ok('移动端底部纯图标导航可见', tabbar >= 5, `${tabbar} 项`);

  const sidebarHidden = await cdp.eval(`getComputedStyle(document.querySelector('.sidebar')).display === 'none'`);
  ok('移动端隐藏桌面侧边栏', sidebarHidden);

  await cdp.shot('03-home-after-init');

  console.log('\n【2】打卡流程');
  await cdp.eval(`document.querySelectorAll('[data-quick]')[0].click(); true`);
  await cdp.waitFor(`document.querySelector('.overlay.on .sheet')`, '打卡弹层');
  await cdp.shot('04-record-sheet');

  const sheetTitle = await cdp.eval(`document.querySelector('.sheet-title').textContent.trim()`);
  ok('打卡弹层正常打开', /打卡|记录/.test(sheetTitle), sheetTitle);

  const fieldCount = await cdp.eval(`document.querySelectorAll('.sheet-body .field').length`);
  ok('弹层按模板字段动态渲染表单', fieldCount >= 3, `${fieldCount} 个字段控件`);

  await cdp.eval(`
    const sel = document.querySelector('.sheet-body [data-select]');
    if (sel) sel.querySelector('.chip:last-child').click();
    const num = document.querySelector('.sheet-body [data-field]');
    if (num) { num.value = '5.2'; num.dispatchEvent(new Event('input', {bubbles:true})); }
    const tags = document.querySelector('.sheet-body [data-tags]');
    if (tags) { tags.value = '晨跑 健身'; tags.dispatchEvent(new Event('input', {bubbles:true})); }
    document.querySelector('.sheet-foot [data-act="save"]').click(); true;
  `);
  await sleep(900);

  const sheetClosed = await cdp.eval(`!document.querySelector('.overlay.on')`);
  ok('保存后弹层关闭', sheetClosed);

  const donePill = await cdp.eval(`!!document.querySelector('.pill-btn.done')`);
  ok('卡片状态更新为「已打卡」', donePill);

  const todayStat = await cdp.eval(`document.querySelector('.stat-card .v').textContent.trim()`);
  ok('今日统计同步刷新', todayStat.startsWith('1'), todayStat);

  console.log('\n【2.5】注入多日演示数据（让热力图与洞察有真实形状）');
  const seeded = await cdp.eval(`
    (async () => {
      const dayKey = (offset) => {
        const d = new Date();
        d.setDate(d.getDate() - offset);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      };
      const tpls = (await (await fetch('/api/templates')).json()).templates;
      const byName = Object.fromEntries(tpls.map((t) => [t.name, t.id]));
      const plan = [
        ['跑步',    [1,2,4,5,7,9,11,13,16,18,20,23,25,28,31,34,37,40], { distance: '5.1', duration: '32', feeling: '正常' }],
        ['阅读',    [0,1,3,4,6,8,10,12,15,17,19,22,24,27,30,33,36,39], { book: '置身事内', pages: '24', minutes: '40' }],
        ['喝水',    [0,1,2,3,4,6,7,8,9,10,12,13,14,15,17,18,20,21,22,24,26,28,30,32,35,38], { amount: '250' }],
        ['冥想',    [2,5,9,12,16,21,26,29,34,38], { minutes: '15', quality: '很好' }],
        ['心情',    [0,3,6,10,14,19,25,29,33,37], { mood: '还行', energy: 3, text: '今天过得不错' }],
        ['随手记',  [1,4,8,13,20,27,35], { text: '记下一个想法', kind: '灵感' }],
      ];
      const tagPool = [['晨跑', '健身'], ['专注', '深度工作'], ['放松'], ['读书', '笔记'], [], ['灵感']];
      let n = 0;
      for (const [name, offsets, values] of plan) {
        const id = byName[name];
        if (!id) continue;
        for (const off of offsets) {
          const res = await fetch('/api/entries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              templateId: id,
              day: dayKey(off),
              values,
              tags: tagPool[(off + name.length) % tagPool.length],
              note: off % 7 === 0 ? '状态不错的一天' : '',
              duration: name === '冥想' ? 900 : 0,
            }),
          });
          if (res.ok) n += 1;
        }
      }
      return n;
    })()
  `, true);
  ok('演示数据写入成功', seeded >= 80, `${seeded} 条记录`);

  await cdp.goto('#/home');
  await cdp.waitFor(`document.querySelector('.tpl-card')`, '带数据的首页');
  await sleep(700);
  const totalText = await cdp.eval(`document.querySelectorAll('.stat-card .v')[3].textContent.trim()`);
  const totalNum = parseInt(totalText.match(/\d+/)?.[0] || '0', 10);
  ok('首页「总计」反映全部数据', totalNum >= seeded, `总计 ${totalText}`);
  const hasCells = await cdp.eval(`document.querySelectorAll('.tpl-card .month-cell.has').length`);
  ok('卡片月点阵标出了已打卡日', hasCells > 0, `${hasCells} 个已标记格`);
  await cdp.shot('03-home-mobile-light');

  console.log('\n【3】各页面渲染');
  const routes = [
    ['#/timeline', '.tl-day', '时间线按天分组'],
    ['#/insights', '.donut', '洞察环形分布图'],
    ['#/manage', '.list-row', '模板管理列表'],
    ['#/settings', '.list-row', '设置列表'],
  ];
  for (const [hash, sel, label] of routes) {
    await cdp.goto(hash);
    try {
      await cdp.waitFor(`document.querySelector('${sel}')`, label, 8000);
      ok(`${label} 渲染成功`, true);
    } catch (e) {
      ok(`${label} 渲染成功`, false, e.message);
    }
    await cdp.shot(`05-${hash.replace('#/', '')}-mobile`);
  }

  await cdp.goto('#/insights');
  await cdp.waitFor(`document.querySelector('.heat-months')`, '年度热力图');
  const heatCells = await cdp.eval(`document.querySelectorAll('.heat-cell').length`);
  ok('年度热力图渲染 12 个月的单元格', heatCells > 360, `${heatCells} 个格子`);

  const trendPath = await cdp.eval(`document.querySelectorAll('.trend path').length`);
  ok('趋势折线图已绘制', trendPath >= 2, `${trendPath} 条路径`);

  await cdp.goto('#/timeline');
  await cdp.waitFor(`document.querySelector('.tl-item')`, '时间线条目');
  const tlItems = await cdp.eval(`document.querySelectorAll('.tl-item').length`);
  ok('时间线出现刚写入的记录', tlItems >= 1, `${tlItems} 条`);

  console.log('\n【4】深色模式与桌面布局');
  await cdp.goto('#/settings');
  await cdp.waitFor(`document.querySelector('[data-theme="dark"]')`, '主题切换');
  await cdp.eval(`document.querySelector('[data-theme="dark"]').click(); true`);
  await sleep(300);
  const theme = await cdp.eval(`document.documentElement.dataset.theme`);
  ok('深色模式切换生效', theme === 'dark', theme);
  await cdp.shot('06-settings-mobile-dark');

  await cdp.goto('#/home');
  await cdp.waitFor(`document.querySelector('.tpl-card')`, '首页深色');
  await sleep(500);
  await cdp.shot('07-home-mobile-dark');

  await cdp.viewport(1440, 960, false);
  await sleep(600);
  const sidebarVisible = await cdp.eval(`getComputedStyle(document.querySelector('.sidebar')).display !== 'none'`);
  ok('桌面宽度显示侧边栏', sidebarVisible);
  const tabbarHidden = await cdp.eval(`getComputedStyle(document.querySelector('.tabbar')).display === 'none'`);
  ok('桌面宽度隐藏底部导航', tabbarHidden);
  await cdp.shot('08-home-desktop-dark');

  await cdp.eval(`document.querySelector('[data-theme="light"]')?.click(); true`);
  await cdp.goto('#/settings');
  await sleep(400);
  await cdp.eval(`document.querySelector('[data-theme="light"]')?.click(); true`);
  await sleep(300);
  await cdp.shot('09-settings-desktop-light');

  await cdp.goto('#/insights');
  await cdp.waitFor(`document.querySelector('.donut')`, '洞察桌面版');
  await sleep(600);
  await cdp.shot('10-insights-desktop-light');

  await cdp.goto('#/manage');
  await cdp.waitFor(`document.querySelector('.list-row')`, '模板管理桌面版');
  await sleep(400);
  await cdp.shot('11-manage-desktop-light');

  console.log('\n【5】会话与错误检查');
  const meStatus = await cdp.eval(`fetch('/api/auth/me').then(r=>r.status)`);
  ok('浏览器持有有效会话', meStatus === 200, `status=${meStatus}`);

  const realErrors = consoleErrors.filter((m) => m && !/favicon|DevTools/i.test(m));
  ok('页面无 JS 运行时错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} catch (err) {
  console.error('\n✗ 测试中断：', err.message);
  failures.push(err.message);
  console.error('服务日志：', serverLog.slice(-800));
}

console.log('');
if (failures.length) {
  console.log(`✗ ${failures.length} 项未通过：\n  - ${failures.join('\n  - ')}`);
} else {
  console.log('✓ 全部通过，截图已保存至 docs/screenshots/');
}

try {
  await cleanup();
} catch {
  console.log('（清理临时目录时出现无关警告，可忽略）');
}
process.exit(failures.length ? 1 : 0);
