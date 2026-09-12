// 首次启动的初始化向导（强制创建管理员）与登录页
import { api } from '../api.js';
import { $, esc, icon, toast } from '../util.js';

const STEP_TITLES = ['创建管理员', '起步模板'];

function setupShell({ step, title, sub, body, foot }) {
  return `<div class="auth">
    <div class="auth-panel">
      <div class="auth-mark">${icon('sparkle', 'i i-28')}</div>
      <div class="auth-title">${esc(title)}</div>
      <div class="auth-sub">${esc(sub)}</div>
      <div class="setup-steps" style="margin-top:20px">
        ${STEP_TITLES.map((_, i) => `<div class="setup-step ${i <= step ? 'on' : ''}"></div>`).join('')}
      </div>
      ${body}
      ${foot}
    </div>
  </div>`;
}

/**
 * 首次启动：强制创建管理员账号，未完成前所有业务接口都不可用
 */
export function renderSetup(root, ctx) {
  let step = 0;
  let form = { siteName: '年轮', username: '', displayName: '', password: '', confirm: '', seedTemplates: true };
  let error = '';

  function draw() {
    const stepBody =
      step === 0
        ? `<div class="auth-form">
            <label class="field"><span class="field-label">站点名称</span>
              <input class="input" name="siteName" value="${esc(form.siteName)}" maxlength="20" placeholder="年轮">
            </label>
            <label class="field"><span class="field-label">管理员用户名</span>
              <input class="input" name="username" value="${esc(form.username)}" autocomplete="username" placeholder="字母、数字、_ . - ，3–32 位">
            </label>
            <label class="field"><span class="field-label">显示名称<span class="field-hint" style="margin-left:6px">可留空</span></span>
              <input class="input" name="displayName" value="${esc(form.displayName)}" maxlength="20" placeholder="比如：站长">
            </label>
            <label class="field"><span class="field-label">密码</span>
              <input class="input" type="password" name="password" autocomplete="new-password" placeholder="至少 8 位，需含字母和数字">
            </label>
            <label class="field"><span class="field-label">确认密码</span>
              <input class="input" type="password" name="confirm" autocomplete="new-password">
            </label>
            ${error ? `<div class="form-error">${esc(error)}</div>` : ''}
          </div>`
        : `<div class="auth-form">
            <label class="check-row">
              <input type="checkbox" name="seedTemplates" ${form.seedTemplates ? 'checked' : ''}>
              <span>
                <span style="display:block;font-weight:500">同时创建 6 个常用模板</span>
                <span style="display:block;color:var(--text-3);font-size:12px">跑步 / 阅读 / 喝水 / 冥想 / 心情 / 随手记，并分好「健康 · 学习 · 生活」三组</span>
              </span>
            </label>
            <div style="font-size:13px;color:var(--text-2);line-height:1.7">
              年轮不需要额外的服务端账号体系，管理员可以在此之后到「设置 → 用户与权限」里继续添加成员，每个人的记录互相隔离。
            </div>
            ${error ? `<div class="form-error">${esc(error)}</div>` : ''}
          </div>`;

    const foot =
      step === 0
        ? `<div class="auth-form" style="margin-top:18px">
            <button class="btn btn-primary btn-block btn-lg" data-act="next">下一步</button>
          </div>
          <div class="auth-foot">年轮 Nianlun · 数据保存在你自己的 SQLite 里</div>`
        : `<div class="auth-form" style="margin-top:18px">
            <button class="btn btn-primary btn-block btn-lg" data-act="submit">完成初始化</button>
            <button class="btn btn-ghost btn-block" data-act="back">上一步</button>
          </div>`;

    root.innerHTML = setupShell({
      step,
      title: step === 0 ? '先创建一个管理员' : '要不要来一组起步模板',
      sub:
        step === 0
          ? '这是首次启动，需要先建立管理员账号。完成后才能进入年轮。'
          : '空模板列表最难起步。勾选后会写入一组预设，之后随时可以改或删。',
      body: stepBody,
      foot,
    });

    const $el = (n) => root.querySelector(`[name="${n}"]`);
    ['siteName', 'username', 'displayName', 'password', 'confirm'].forEach((n) => {
      const el = $el(n);
      if (!el) return;
      el.addEventListener('input', () => {
        form[n] = el.value;
      });
    });
    const seedEl = $el('seedTemplates');
    seedEl?.addEventListener('change', () => {
      form.seedTemplates = seedEl.checked;
      draw();
    });

    root.querySelector('[data-act="next"]')?.addEventListener('click', async () => {
      form.siteName = ($el('siteName')?.value ?? form.siteName).trim() || '年轮';
      form.username = ($el('username')?.value ?? form.username).trim();
      form.displayName = ($el('displayName')?.value ?? form.displayName).trim();
      form.password = $el('password')?.value ?? form.password;
      form.confirm = $el('confirm')?.value ?? form.confirm;

      if (!/^[A-Za-z0-9_.\-]{3,32}$/.test(form.username)) {
        error = '用户名需为 3–32 位，仅允许字母、数字、下划线、点或短横线';
        return draw();
      }
      if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) {
        error = '密码至少 8 位，且需同时包含字母和数字';
        return draw();
      }
      if (form.password !== form.confirm) {
        error = '两次输入的密码不一致';
        return draw();
      }
      error = '';
      step = 1;
      draw();
    });

    root.querySelector('[data-act="back"]')?.addEventListener('click', () => {
      step = 0;
      error = '';
      draw();
    });

    root.querySelector('[data-act="submit"]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = '正在初始化…';
      try {
        const res = await api.createAdmin({
          siteName: form.siteName,
          username: form.username,
          displayName: form.displayName || form.username,
          password: form.password,
          seedTemplates: form.seedTemplates,
        });
        const config = await api.setupStatus();
        toast('初始化完成，欢迎使用年轮', 'ok');
        await ctx.signIn(res.user, config);
      } catch (err) {
        error = err.message;
        btn.disabled = false;
        draw();
      }
    });
  }

  draw();
}

export function renderLogin(root, ctx) {
  const siteName = ctx.state?.config?.siteName || '年轮';
  let error = '';

  function draw() {
    root.innerHTML = `<div class="auth">
      <div class="auth-panel">
        <div class="auth-mark">${icon('sparkle', 'i i-28')}</div>
        <div class="auth-title">${esc(siteName)}</div>
        <div class="auth-sub">登录后继续记录你的年轮。</div>
        <form class="auth-form" autocomplete="on">
          <label class="field"><span class="field-label">用户名</span>
            <input class="input" name="username" autocomplete="username" autofocus>
          </label>
          <label class="field"><span class="field-label">密码</span>
            <input class="input" type="password" name="password" autocomplete="current-password">
          </label>
          ${error ? `<div class="form-error">${esc(error)}</div>` : ''}
          <button class="btn btn-primary btn-block btn-lg" type="submit">登录</button>
        </form>
        <div class="auth-foot">年轮 Nianlun · 零依赖 Node + SQLite</div>
      </div>
    </div>`;

    const formEl = root.querySelector('form');
    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = formEl.querySelector('button[type="submit"]');
      const username = formEl.querySelector('[name="username"]').value.trim();
      const password = formEl.querySelector('[name="password"]').value;
      if (!username || !password) {
        error = '请填写用户名和密码';
        return draw();
      }
      btn.disabled = true;
      btn.textContent = '登录中…';
      try {
        const res = await api.login({ username, password });
        await ctx.signIn(res.user);
      } catch (err) {
        error = err.message;
        draw();
      }
    });
  }

  draw();
}
