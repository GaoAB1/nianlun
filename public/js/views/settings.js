// 设置：外观 / 账号 / 用户与权限 / 数据 / 关于
import { api } from '../api.js';
import { $, esc, fmtDateTime, icon, relativeTime, toast } from '../util.js';
import { pageShell } from '../shell.js';
import { confirmDelete, palette, sheet } from '../components.js';

const THEMES = [
  { key: 'light', label: '浅色', icon: 'sun' },
  { key: 'dark', label: '深色', icon: 'moon' },
  { key: 'auto', label: '跟随系统', icon: 'settings' },
];

export async function render(root, ctx, { active }) {
  const s = ctx.state;
  const user = s.user;
  const isAdmin = user?.role === 'admin';
  const users = isAdmin ? (await api.get('/api/users')).users : [];

  const row = ({ action, iconName, title, sub, tail = '', danger = false, attrs = '' }) => `<button class="list-row" data-act="${action}" ${attrs}>
    <span class="list-icon" style="${danger ? 'background:var(--danger-soft);color:var(--danger)' : ''}">${icon(iconName, 'i i-18')}</span>
    <span class="list-main"><span class="list-title">${esc(title)}</span>${sub ? `<span class="list-sub">${esc(sub)}</span>` : ''}</span>
    ${tail ? `<span class="list-tail">${tail}</span>` : ''}
  </button>`;

  const body = `
    <div class="card" style="display:flex;align-items:center;gap:14px">
      <span class="avatar avatar-lg" style="background:${esc(user.avatarColor || '#5B9BF3')}">${esc([...(user.displayName || user.username)][0])}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:17px;font-weight:600;letter-spacing:-.01em">${esc(user.displayName || user.username)}</div>
        <div style="font-size:12.5px;color:var(--text-3)">@${esc(user.username)} · ${isAdmin ? '管理员' : '成员'}</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:2px">${user.lastLoginAt ? `上次登录 ${esc(relativeTime(user.lastLoginAt))}` : '首次登录'}</div>
      </div>
      <button class="btn btn-ghost btn-sm" data-act="account">编辑</button>
    </div>

    <div class="section-head" style="margin-top:26px"><div class="section-title">外观</div></div>
    <div class="list">
      <div class="list-row">
        <span class="list-icon">${icon('sun', 'i i-18')}</span>
        <span class="list-main"><span class="list-title">主题</span><span class="list-sub">深色模式跟随偏好</span></span>
        <span class="segment" style="width:186px">
          ${THEMES.map((t) => `<button data-theme="${t.key}" class="${s.theme === t.key ? 'on' : ''}">${t.label}</button>`).join('')}
        </span>
      </div>
      <div class="list-row">
        <span class="list-icon">${icon('calendar', 'i i-18')}</span>
        <span class="list-main"><span class="list-title">每周起始日</span><span class="list-sub">影响周视图与热力图排布</span></span>
        <span class="segment" style="width:150px">
          <button data-week="1" class="${s.weekStartsOn === 1 ? 'on' : ''}">周一</button>
          <button data-week="0" class="${s.weekStartsOn === 0 ? 'on' : ''}">周日</button>
        </span>
      </div>
    </div>

    <div class="section-head" style="margin-top:26px"><div class="section-title">账号</div></div>
    <div class="list">
      ${row({ action: 'account', iconName: 'user', title: '个人资料与密码', sub: '修改显示名称、头像颜色，或更换密码' })}
      ${row({ action: 'logout', iconName: 'logout', title: '退出登录', sub: '当前设备上的会话会被清除', danger: true })}
    </div>

    ${
      isAdmin
        ? `<div class="section-head" style="margin-top:26px"><div class="section-title">用户与权限</div><div class="section-hint">${users.length} 个账号</div></div>
           <div class="list">
             ${users
               .map(
                 (u) => `<div class="list-row">
                   <span class="avatar avatar-sm" style="background:${esc(u.avatarColor)}">${esc([...(u.displayName || u.username)][0])}</span>
                   <span class="list-main">
                     <span class="list-title">${esc(u.displayName || u.username)}${u.id === user.id ? ' <span class="badge badge-brand">我</span>' : ''}</span>
                     <span class="list-sub">@${esc(u.username)} · ${u.entryCount} 条记录 · ${u.templateCount} 个模板</span>
                   </span>
                   <span class="list-tail">
                     ${u.role === 'admin' ? '<span class="badge badge-ok">管理员</span>' : ''}
                     ${u.status === 'disabled' ? '<span class="badge badge-danger">已禁用</span>' : ''}
                     <button class="icon-btn" data-u-menu="${u.id}" aria-label="管理">${icon('more', 'i i-18')}</button>
                   </span>
                 </div>`
               )
               .join('')}
             <button class="list-row" data-act="new-user">
               <span class="list-icon">${icon('plus', 'i i-18')}</span>
               <span class="list-main"><span class="list-title">添加成员</span><span class="list-sub">每个人的记录互相隔离</span></span>
             </button>
           </div>`
        : ''
    }

    <div class="section-head" style="margin-top:26px"><div class="section-title">数据</div></div>
    <div class="list">
      ${row({ action: 'export', iconName: 'download', title: '导出全部数据', sub: '下载一份包含模板与记录的 JSON 备份' })}
      ${row({ action: 'import', iconName: 'upload', title: '从备份导入', sub: '支持合并或覆盖，覆盖会先清空现有模板' })}
      ${row({ action: 'clear', iconName: 'trash', title: '清空记录', sub: '只删除记录，保留模板', danger: true })}
    </div>

    <div class="section-head" style="margin-top:26px"><div class="section-title">关于</div></div>
    <div class="list">
      <div class="list-row">
        <span class="list-icon">${icon('sparkle', 'i i-18')}</span>
        <span class="list-main"><span class="list-title">${esc(s.config.siteName || '年轮')} · Nianlun</span><span class="list-sub">零依赖 Node + SQLite · 数据保存在你自己的机器上</span></span>
        <span class="list-tail"><span class="badge badge-ok">v1.0.0</span></span>
      </div>
      ${
        isAdmin
          ? `<button class="list-row" data-act="rename-site">
               <span class="list-icon">${icon('edit', 'i i-18')}</span>
               <span class="list-main"><span class="list-title">站点名称</span><span class="list-sub">当前：${esc(s.config.siteName || '年轮')}</span></span>
             </button>`
          : ''
      }
    </div>
    <div style="height:20px"></div>`;

  root.innerHTML = pageShell(s, {
    title: '设置',
    subtitle: isAdmin ? '管理员' : '成员',
    active,
    body,
  });

  const click = (act, fn) => root.querySelectorAll(`[data-act="${act}"]`).forEach((el) => el.addEventListener('click', fn));

  click('account', () => openAccountSheet(ctx));
  click('logout', () =>
    confirmDelete({
      title: '退出登录？',
      text: '记录不会丢失，下次登录继续。',
      confirmText: '退出',
      onConfirm: async () => {
        await api.logout();
        location.hash = '';
        location.reload();
      },
    })
  );
  click('export', async () => {
    const data = await api.get('/api/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nianlun-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('备份已开始下载', 'ok');
  });

  click('import', () => openImportSheet(ctx));
  click('clear', () =>
    confirmDelete({
      title: '清空全部记录？',
      text: '模板会保留，但所有记录会永久删除，无法恢复。建议先导出备份。',
      confirmText: '确认清空',
      onConfirm: async () => {
        await api.post('/api/data/clear', { confirm: 'DELETE', scope: 'entries' });
        await ctx.loadTemplates();
        toast('记录已清空', 'ok');
        ctx.render();
      },
    })
  );

  click('new-user', () => openUserSheet(ctx));
  click('rename-site', () => openSiteSheet(ctx));

  root.querySelectorAll('[data-theme]').forEach((el) =>
    el.addEventListener('click', () => {
      ctx.setTheme(el.dataset.theme);
      root.querySelectorAll('[data-theme]').forEach((b) => b.classList.toggle('on', b.dataset.theme === el.dataset.theme));
    })
  );

  root.querySelectorAll('[data-week]').forEach((el) =>
    el.addEventListener('click', async () => {
      ctx.setWeekStart(Number(el.dataset.week));
      root.querySelectorAll('[data-week]').forEach((b) => b.classList.toggle('on', b.dataset.week === el.dataset.week));
      await ctx.loadTemplates().catch(() => {});
    })
  );

  root.querySelectorAll('[data-u-menu]').forEach((el) =>
    el.addEventListener('click', async () => {
      const u = users.find((x) => x.id === Number(el.dataset.uMenu));
      const { openMenu } = await import('../components.js');
      openMenu(el, [
        { label: '重置密码', icon: 'lock', onSelect: () => openResetSheet(ctx, u) },
        { label: '编辑资料', icon: 'edit', onSelect: () => openUserSheet(ctx, u) },
        {
          label: u.status === 'active' ? '禁用账号' : '启用账号',
          icon: u.status === 'active' ? 'archive' : 'check',
          danger: u.status === 'active',
          onSelect: async () => {
            try {
              await api.patch(`/api/users/${u.id}`, { status: u.status === 'active' ? 'disabled' : 'active' });
              toast('已更新', 'ok');
              ctx.render();
            } catch (err) {
              toast(err.message, 'err');
            }
          },
        },
        {
          label: u.role === 'admin' ? '降为成员' : '提升为管理员',
          icon: 'users',
          onSelect: async () => {
            try {
              await api.patch(`/api/users/${u.id}`, { role: u.role === 'admin' ? 'member' : 'admin' });
              toast('已更新角色', 'ok');
              ctx.render();
            } catch (err) {
              toast(err.message, 'err');
            }
          },
        },
        {
          label: '删除账号',
          icon: 'trash',
          danger: true,
          onSelect: () =>
            confirmDelete({
              title: `删除「${u.username}」？`,
              text: `该账号的 ${u.entryCount} 条记录会一并删除，无法恢复。`,
              onConfirm: async () => {
                try {
                  await api.del(`/api/users/${u.id}`);
                  toast('账号已删除', 'ok');
                  ctx.render();
                } catch (err) {
                  toast(err.message, 'err');
                }
              },
            }),
        },
      ]);
    })
  );
}

// ---------------------------------------------------------------- 个人资料
export function openAccountSheet(ctx) {
  const user = ctx.state.user;
  let color = user.avatarColor || '#5B9BF3';

  sheet({
    title: '个人资料',
    body: `<div style="display:flex;flex-direction:column;gap:18px">
      <div style="display:flex;align-items:center;gap:14px">
        <span class="avatar avatar-lg" id="acc-avatar" style="background:${esc(color)}">${esc([...(user.displayName || user.username)][0])}</span>
        <div class="color-row">${palette.map((c) => `<button class="color-opt ${c === color ? 'on' : ''}" style="background:${c};color:${c}" data-acc-color="${c}"></button>`).join('')}</div>
      </div>
      <label class="field"><span class="field-label">显示名称</span>
        <input class="input" data-acc-name value="${esc(user.displayName || '')}" maxlength="20">
      </label>
      <button class="btn btn-ghost" data-act="save-profile">保存资料</button>

      <hr class="hair">
      <div class="field-label">修改密码</div>
      <label class="field"><span class="field-label">当前密码</span><input class="input" type="password" data-pw-cur autocomplete="current-password"></label>
      <label class="field"><span class="field-label">新密码</span><input class="input" type="password" data-pw-new autocomplete="new-password" placeholder="至少 8 位，含字母和数字"></label>
      <label class="field"><span class="field-label">确认新密码</span><input class="input" type="password" data-pw-confirm autocomplete="new-password"></label>
      <button class="btn btn-primary" data-act="save-password">更新密码</button>
      <div class="field-hint">更新密码后，其他设备上的登录会被强制退出。</div>
    </div>`,
    onMount: (root, close) => {
      root.querySelectorAll('[data-acc-color]').forEach((el) =>
        el.addEventListener('click', () => {
          color = el.dataset.accColor;
          root.querySelector('#acc-avatar').style.background = color;
          root.querySelectorAll('[data-acc-color]').forEach((b) => b.classList.toggle('on', b.dataset.accColor === color));
        })
      );

      root.querySelector('[data-act="save-profile"]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const res = await api.patch('/api/auth/profile', {
            displayName: root.querySelector('[data-acc-name]').value.trim(),
            avatarColor: color,
          });
          ctx.setUser(res.user);
          toast('资料已保存', 'ok');
          close();
          ctx.render();
        } catch (err) {
          btn.disabled = false;
          toast(err.message, 'err');
        }
      });

      root.querySelector('[data-act="save-password"]').addEventListener('click', async (e) => {
        const cur = root.querySelector('[data-pw-cur]').value;
        const next = root.querySelector('[data-pw-new]').value;
        const confirm = root.querySelector('[data-pw-confirm]').value;
        if (next !== confirm) return toast('两次输入的新密码不一致', 'err');
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await api.post('/api/auth/password', { currentPassword: cur, newPassword: next });
          toast('密码已更新', 'ok');
          close();
        } catch (err) {
          btn.disabled = false;
          toast(err.message, 'err');
        }
      });
    },
  });
}

// ---------------------------------------------------------------- 用户编辑
function openUserSheet(ctx, target = null) {
  const isNew = !target;
  sheet({
    title: isNew ? '添加成员' : `编辑 · ${target.username}`,
    body: `<div style="display:flex;flex-direction:column;gap:16px">
      ${
        isNew
          ? `<label class="field"><span class="field-label">用户名</span><input class="input" data-u-name placeholder="字母、数字、_ . - ，3–32 位"></label>
             <label class="field"><span class="field-label">初始密码</span><input class="input" type="password" data-u-pw placeholder="至少 8 位，含字母和数字"></label>`
          : ''
      }
      <label class="field"><span class="field-label">显示名称</span>
        <input class="input" data-u-display value="${esc(target?.displayName || '')}" maxlength="20">
      </label>
      ${
        isNew
          ? `<label class="field"><span class="field-label">角色</span>
               <select class="select" data-u-role><option value="member">成员</option><option value="admin">管理员</option></select>
             </label>
             <label class="check-row"><input type="checkbox" data-u-seed checked><span>同时为该成员创建 6 个预设模板</span></label>`
          : ''
      }
    </div>`,
    footer: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">${isNew ? '创建' : '保存'}</button>`,
    onMount: (root, close) => {
      root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      root.querySelector('[data-act="save"]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          if (isNew) {
            await api.post('/api/users', {
              username: root.querySelector('[data-u-name]').value.trim(),
              password: root.querySelector('[data-u-pw]').value,
              displayName: root.querySelector('[data-u-display]').value.trim(),
              role: root.querySelector('[data-u-role]').value,
              seedTemplates: root.querySelector('[data-u-seed]').checked,
            });
          } else {
            await api.patch(`/api/users/${target.id}`, { displayName: root.querySelector('[data-u-display]').value.trim() });
          }
          close();
          toast(isNew ? '成员已创建' : '已保存', 'ok');
          ctx.render();
        } catch (err) {
          btn.disabled = false;
          toast(err.message, 'err');
        }
      });
    },
  });
}

function openResetSheet(ctx, target) {
  sheet({
    title: `重置「${target.username}」的密码`,
    body: `<label class="field"><span class="field-label">新密码</span>
        <input class="input" type="password" data-new-pw placeholder="至少 8 位，含字母和数字"></label>
      <div class="field-hint" style="margin-top:8px">该用户在所有设备上的登录都会失效。</div>`,
    footer: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">重置</button>`,
    onMount: (root, close) => {
      root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      root.querySelector('[data-act="save"]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await api.post(`/api/users/${target.id}/password`, { newPassword: root.querySelector('[data-new-pw]').value });
          close();
          toast('密码已重置', 'ok');
        } catch (err) {
          btn.disabled = false;
          toast(err.message, 'err');
        }
      });
    },
  });
}

function openSiteSheet(ctx) {
  sheet({
    title: '站点名称',
    body: `<label class="field"><span class="field-label">显示在浏览器标题与侧边栏</span>
        <input class="input" data-site value="${esc(ctx.state.config.siteName || '年轮')}" maxlength="20"></label>`,
    footer: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">保存</button>`,
    onMount: (root, close) => {
      root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      root.querySelector('[data-act="save"]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const res = await api.put('/api/settings', { siteName: root.querySelector('[data-site]').value.trim() });
          ctx.state.config.siteName = res.siteName;
          document.title = `${res.siteName} · Nianlun`;
          close();
          toast('已保存', 'ok');
          ctx.render();
        } catch (err) {
          btn.disabled = false;
          toast(err.message, 'err');
        }
      });
    },
  });
}

// ---------------------------------------------------------------- 导入
function openImportSheet(ctx) {
  let payload = null;
  let mode = 'merge';

  sheet({
    title: '从备份导入',
    body: `<div style="display:flex;flex-direction:column;gap:16px">
      <label class="field"><span class="field-label">选择备份文件</span>
        <input class="input" type="file" accept="application/json" data-file>
      </label>
      <div class="field"><span class="field-label">导入方式</span>
        <div class="segment">
          <button data-imode="merge" class="on">合并（保留现有）</button>
          <button data-imode="replace">覆盖（先清空模板）</button>
        </div>
      </div>
      <div class="field-hint" data-summary>请选择由年轮导出的 JSON 文件。</div>
    </div>`,
    footer: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save" disabled>开始导入</button>`,
    onMount: (root, close) => {
      const summary = root.querySelector('[data-summary]');
      const saveBtn = root.querySelector('[data-act="save"]');

      root.querySelector('[data-file]').addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          if (parsed.format !== 'nianlun-export') throw new Error('不是年轮导出的备份文件');
          payload = parsed;
          summary.textContent = `包含 ${parsed.templates.length} 个模板、${parsed.entries.length} 条记录，导出于 ${fmtDateTime(Math.floor(new Date(parsed.exportedAt).getTime() / 1000))}`;
          saveBtn.disabled = false;
        } catch (err) {
          payload = null;
          summary.textContent = `解析失败：${err.message}`;
          saveBtn.disabled = true;
        }
      });

      root.querySelectorAll('[data-imode]').forEach((el) =>
        el.addEventListener('click', () => {
          mode = el.dataset.imode;
          root.querySelectorAll('[data-imode]').forEach((b) => b.classList.toggle('on', b.dataset.imode === mode));
        })
      );

      root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      saveBtn.addEventListener('click', async () => {
        if (!payload) return;
        saveBtn.disabled = true;
        saveBtn.textContent = '导入中…';
        try {
          const res = await api.post('/api/import', { ...payload, mode });
          close();
          toast(`导入完成：${res.createdTemplates} 个模板、${res.createdEntries} 条记录`, 'ok');
          await ctx.loadTemplates();
          ctx.render();
        } catch (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = '开始导入';
          toast(err.message, 'err');
        }
      });
    },
  });
}

export { $ };
