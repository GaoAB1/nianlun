// 模板与分组管理，以及模板编辑器（含字段编辑器）
import { api } from '../api.js';
import { $, esc, icon, toast } from '../util.js';
import { pageShell } from '../shell.js';
import { closeSheet, confirmDelete, emptyState, palette, sheet } from '../components.js';

const EMOJIS = [
  '🏃', '🚶', '🚴', '🏊', '🧘', '💪', '🥗', '💧', '😴', '🦷',
  '📖', '✍️', '🎧', '🎬', '🎮', '💻', '🧠', '📚', '🎨', '🎹',
  '🫧', '😊', '🌱', '🌙', '☀️', '🍀', '🔥', '⭐️', '📌', '📝',
  '☕️', '🍱', '🧹', '💰', '🚇', '📷', '💊', '⏱️', '🕯️', '🗓️',
];

const FIELD_TYPES = [
  { value: 'text', label: '文字' },
  { value: 'number', label: '数字' },
  { value: 'select', label: '选项' },
  { value: 'rating', label: '评分' },
  { value: 'image', label: '图片' },
];

const PERIOD_LABEL = { day: '每天', week: '每周', month: '每月', year: '每年' };

export async function render(root, ctx, { active }) {
  const s = ctx.state;
  await ctx.loadTemplates();
  const templates = s.templates;
  const groups = s.groups;

  const archived = templates.filter((t) => t.archived);

  const groupRow = (g) => `<div class="list-row">
    <span class="list-icon" style="background:color-mix(in srgb, ${g.color} 18%, transparent);color:${g.color}">${icon('folder', 'i i-18')}</span>
    <span class="list-main">
      <span class="list-title">${esc(g.name)}</span>
      <span class="list-sub">${g.templateCount} 个模板</span>
    </span>
    <span class="list-tail">
      <button class="icon-btn" data-g-edit="${g.id}" aria-label="重命名">${icon('edit', 'i i-18')}</button>
      <button class="icon-btn danger" data-g-del="${g.id}" aria-label="删除">${icon('trash', 'i i-18')}</button>
    </span>
  </div>`;

  const templateRow = (t) => `<div class="list-row">
    <span class="tl-emoji" style="width:36px;height:36px;font-size:17px;border-radius:11px;background:color-mix(in srgb, ${t.color} 16%, transparent)">${esc(t.emoji)}</span>
    <span class="list-main">
      <span class="list-title">${esc(t.name)}${t.archived ? ' <span class="badge">已归档</span>' : ''}</span>
      <span class="list-sub">${t.mode === 'checkin' ? '打卡' : '记录'} · ${(t.fields || []).length} 个字段${t.goal_value ? ` · 目标 ${t.goal_value} 次/${PERIOD_LABEL[t.goal_period] || '每月'}` : ''}</span>
    </span>
    <span class="list-tail">
      <button class="icon-btn" data-t-up="${t.id}" aria-label="上移">${icon('up', 'i i-18')}</button>
      <button class="icon-btn" data-t-down="${t.id}" aria-label="下移">${icon('down', 'i i-18')}</button>
      <button class="icon-btn" data-t-edit="${t.id}" aria-label="编辑">${icon('edit', 'i i-18')}</button>
      <button class="icon-btn danger" data-t-del="${t.id}" aria-label="删除">${icon('trash', 'i i-18')}</button>
    </span>
  </div>`;

  const body = `
    <div class="section-head">
      <div class="section-title">分组</div>
      <button class="btn btn-ghost btn-sm" data-act="new-group">${icon('plus', 'i i-16')}新建分组</button>
    </div>
    <div class="list">
      ${groups.length ? groups.map(groupRow).join('') : `<div class="list-row"><span class="list-main"><span class="list-sub">还没有分组。分组用来把模板按「健康 / 学习 / 生活」这类维度归拢。</span></span></div>`}
    </div>

    <div class="section-head" style="margin-top:28px">
      <div class="section-title">模板</div>
      <button class="btn btn-ghost btn-sm" data-act="new-template">${icon('plus', 'i i-16')}新建模板</button>
    </div>
    ${
      templates.length
        ? `<div class="list">${templates.map(templateRow).join('')}</div>`
        : `<div class="card">${emptyState({
            iconName: 'grid',
            title: '还没有模板',
            text: '模板决定要记下哪些内容：字段可以选文字、数字、选项、评分或图片。',
            actionLabel: '创建模板',
            action: 'new-template',
          })}</div>`
    }
    ${
      archived.length
        ? `<div class="section-head" style="margin-top:28px"><div class="section-title">已归档</div><div class="section-hint">${archived.length} 个</div></div>
           <div class="list">${archived
             .map(
               (t) => `<div class="list-row">
                 <span class="tl-emoji" style="width:36px;height:36px;font-size:17px;border-radius:11px;background:var(--surface-3)">${esc(t.emoji)}</span>
                 <span class="list-main"><span class="list-title">${esc(t.name)}</span><span class="list-sub">${t.stats?.total ?? 0} 条历史记录</span></span>
                 <span class="list-tail"><button class="btn btn-ghost btn-sm" data-t-restore="${t.id}">恢复</button></span>
               </div>`
             )
             .join('')}</div>`
        : ''
    }
    <div style="height:20px"></div>`;

  root.innerHTML = pageShell(s, {
    title: '模板',
    subtitle: `${templates.length} 个模板 · ${groups.length} 个分组`,
    active,
    actions: `<button class="icon-btn" data-act="new-template" title="新建模板">${icon('plus')}</button>`,
    body,
  });

  const byId = (id) => templates.find((t) => t.id === Number(id));

  root.querySelectorAll('[data-act="new-template"]').forEach((el) => el.addEventListener('click', () => openTemplateEditor(ctx)));
  root.querySelectorAll('[data-act="new-group"]').forEach((el) => el.addEventListener('click', () => openGroupSheet(ctx)));

  root.querySelectorAll('[data-g-edit]').forEach((el) =>
    el.addEventListener('click', () => openGroupSheet(ctx, groups.find((g) => g.id === Number(el.dataset.gEdit))))
  );

  root.querySelectorAll('[data-g-del]').forEach((el) =>
    el.addEventListener('click', () => {
      const g = groups.find((x) => x.id === Number(el.dataset.gDel));
      confirmDelete({
        title: `删除分组「${g.name}」？`,
        text: '分组内的模板不会被删除，只会变成未分组。',
        onConfirm: async () => {
          await api.del(`/api/groups/${g.id}`);
          await ctx.loadTemplates();
          ctx.render();
          toast('分组已删除', 'ok');
        },
      });
    })
  );

  root.querySelectorAll('[data-t-edit]').forEach((el) => el.addEventListener('click', () => openTemplateEditor(ctx, byId(el.dataset.tEdit))));

  root.querySelectorAll('[data-t-del]').forEach((el) =>
    el.addEventListener('click', () => {
      const t = byId(el.dataset.tDel);
      confirmDelete({
        title: `删除「${t.name}」？`,
        text: `该模板下的 ${t.stats?.total ?? 0} 条记录会一并删除，且无法恢复。`,
        onConfirm: async () => {
          await api.del(`/api/templates/${t.id}`);
          await ctx.loadTemplates();
          ctx.render();
          toast('模板已删除', 'ok');
        },
      });
    })
  );

  root.querySelectorAll('[data-t-restore]').forEach((el) =>
    el.addEventListener('click', async () => {
      await api.patch(`/api/templates/${el.dataset.tRestore}`, { archived: false });
      await ctx.loadTemplates();
      ctx.render();
    })
  );

  async function move(id, delta) {
    const list = templates.map((t) => t.id);
    const i = list.indexOf(Number(id));
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await api.put('/api/templates/order', { ids: list });
    await ctx.loadTemplates();
    ctx.render();
  }
  root.querySelectorAll('[data-t-up]').forEach((el) => el.addEventListener('click', () => move(el.dataset.tUp, -1)));
  root.querySelectorAll('[data-t-down]').forEach((el) => el.addEventListener('click', () => move(el.dataset.tDown, 1)));
}

// ---------------------------------------------------------------- 分组编辑
export function openGroupSheet(ctx, group = null) {
  let color = group?.color || palette[(ctx.state.groups?.length || 0) % palette.length];
  let name = group?.name || '';

  sheet({
    title: group ? '重命名分组' : '新建分组',
    body: `<div style="display:flex;flex-direction:column;gap:16px">
      <label class="field"><span class="field-label">分组名称</span>
        <input class="input" data-name value="${esc(name)}" maxlength="24" placeholder="比如：健康">
      </label>
      <div class="field"><span class="field-label">颜色</span>
        <div class="color-row">${palette.map((c) => `<button class="color-opt ${c === color ? 'on' : ''}" style="background:${c};color:${c}" data-color="${c}"></button>`).join('')}</div>
      </div>
    </div>`,
    footer: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">${group ? '保存' : '创建'}</button>`,
    onMount: (root, close) => {
      root.querySelector('[data-name]').focus();
      root.querySelectorAll('[data-color]').forEach((el) =>
        el.addEventListener('click', () => {
          color = el.dataset.color;
          root.querySelectorAll('[data-color]').forEach((c) => c.classList.toggle('on', c.dataset.color === color));
        })
      );
      root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      root.querySelector('[data-act="save"]').addEventListener('click', async (e) => {
        const value = root.querySelector('[data-name]').value.trim();
        if (!value) return toast('请填写分组名称', 'err');
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          if (group) await api.patch(`/api/groups/${group.id}`, { name: value, color });
          else await api.post('/api/groups', { name: value, color });
          close();
          await ctx.loadTemplates();
          ctx.render();
          toast(group ? '分组已更新' : '分组已创建', 'ok');
        } catch (err) {
          btn.disabled = false;
          toast(err.message, 'err');
        }
      });
    },
  });
}

// ---------------------------------------------------------------- 模板编辑器
export function openTemplateEditor(ctx, template = null) {
  const s = ctx.state;
  const isNew = !template;
  let fields = JSON.parse(JSON.stringify(template?.fields || []));
  let draft = {
    name: template?.name || '',
    emoji: template?.emoji || '📌',
    color: template?.color || palette[(s.templates?.length || 0) % palette.length],
    mode: template?.mode || 'checkin',
    description: template?.description || '',
    groupId: template?.group_id ?? '',
    goalValue: template?.goal_value ?? 0,
    goalPeriod: template?.goal_period || 'month',
  };

  const fieldExtra = (f, i) => {
    if (f.type === 'number') {
      return `<div class="row-2">
        <input class="input" data-f-unit="${i}" value="${esc(f.unit || '')}" placeholder="单位，如 km / 页 / 分钟" maxlength="8">
        <input class="input" data-f-ph="${i}" value="${esc(f.placeholder || '')}" placeholder="输入提示" maxlength="24">
      </div>`;
    }
    if (f.type === 'select') {
      return `<input class="input" data-f-opts="${i}" value="${esc((f.options || []).join(' / '))}" placeholder="选项用 / 或逗号分隔，如：很好 / 还行 / 一般">`;
    }
    if (f.type === 'rating') {
      return `<select class="select" data-f-max="${i}">
        ${[3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}" ${(f.max || 5) === n ? 'selected' : ''}>满分 ${n} 星</option>`).join('')}
      </select>`;
    }
    if (f.type === 'text') {
      return `<input class="input" data-f-ph="${i}" value="${esc(f.placeholder || '')}" placeholder="输入提示（可留空）" maxlength="40">`;
    }
    return `<div class="field-hint">可上传最多 6 张图片，前端会自动压缩后保存。</div>`;
  };

  const fieldBlock = (f, i) => `<div class="field-editor" data-fi="${i}">
    <div class="field-editor-head">
      <input class="input" data-f-label="${i}" value="${esc(f.label || '')}" placeholder="字段名称" maxlength="20" style="flex:1">
      <select class="select" data-f-type="${i}" style="width:100px">
        ${FIELD_TYPES.map((t) => `<option value="${t.value}" ${f.type === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
      </select>
      <button class="icon-btn danger" data-f-remove="${i}" aria-label="删除字段">${icon('trash', 'i i-18')}</button>
    </div>
    ${fieldExtra(f, i)}
  </div>`;

  const body = () => `
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="row-2">
        <label class="field"><span class="field-label">模板名称</span>
          <input class="input" data-name value="${esc(draft.name)}" maxlength="24" placeholder="比如：跑步">
        </label>
        <div class="field"><span class="field-label">类型</span>
          <div class="segment">
            <button data-mode="checkin" class="${draft.mode === 'checkin' ? 'on' : ''}">打卡</button>
            <button data-mode="record" class="${draft.mode === 'record' ? 'on' : ''}">记录</button>
          </div>
        </div>
      </div>

      <div class="field"><span class="field-label">图标</span>
        <div class="emoji-picker">
          ${EMOJIS.map((e) => `<button class="emoji-opt ${e === draft.emoji ? 'on' : ''}" data-emoji="${e}">${e}</button>`).join('')}
        </div>
      </div>

      <div class="field"><span class="field-label">颜色</span>
        <div class="color-row">${palette.map((c) => `<button class="color-opt ${c === draft.color ? 'on' : ''}" style="background:${c};color:${c}" data-color="${c}"></button>`).join('')}</div>
      </div>

      <label class="field"><span class="field-label">描述<span class="field-hint" style="margin-left:6px">可留空</span></span>
        <input class="input" data-desc value="${esc(draft.description)}" maxlength="60" placeholder="一句话说明这个模板记什么">
      </label>

      <div class="row-2">
        <label class="field"><span class="field-label">所属分组</span>
          <select class="select" data-group>
            <option value="">未分组</option>
            ${(s.groups || []).map((g) => `<option value="${g.id}" ${String(draft.groupId) === String(g.id) ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span class="field-label">周期目标<span class="field-hint" style="margin-left:6px">0 表示不设目标</span></span>
          <div style="display:flex;gap:8px">
            <input class="input" type="number" min="0" max="9999" data-goal value="${draft.goalValue}" style="width:100px">
            <select class="select" data-goal-period>
              ${Object.entries(PERIOD_LABEL).map(([k, v]) => `<option value="${k}" ${draft.goalPeriod === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </div>
        </label>
      </div>

      <div class="field">
        <span class="field-label">记录字段<span class="field-hint" style="margin-left:6px">最多 12 个</span></span>
        <div id="fields-host">
          ${fields.length ? fields.map(fieldBlock).join('') : '<div class="field-hint" style="padding:4px 2px">还没有字段。没有字段时，一次点击就是一条记录。</div>'}
        </div>
        <button class="btn btn-ghost btn-sm" data-act="add-field" style="margin-top:10px;align-self:flex-start">${icon('plus', 'i i-16')}添加字段</button>
      </div>
    </div>`;

  sheet({
    title: isNew ? '新建模板' : `编辑 · ${template.name}`,
    wide: true,
    body: body(),
    footer: `${!isNew ? `<button class="btn btn-danger" data-act="delete">删除</button>` : ''}
      <button class="btn btn-primary" data-act="save">${isNew ? '创建模板' : '保存'}</button>`,
    onMount: (root, close) => {
      const readFields = () => {
        root.querySelectorAll('[data-fi]').forEach((el, i) => {
          if (!fields[i]) return;
          const label = el.querySelector(`[data-f-label="${i}"]`)?.value?.trim();
          if (label) fields[i].label = label;
          const unit = el.querySelector(`[data-f-unit="${i}"]`)?.value?.trim();
          if (unit !== undefined) fields[i].unit = unit;
          const ph = el.querySelector(`[data-f-ph="${i}"]`)?.value?.trim();
          if (ph !== undefined) fields[i].placeholder = ph;
          const opts = el.querySelector(`[data-f-opts="${i}"]`)?.value;
          if (opts !== undefined) {
            fields[i].options = [...new Set(opts.split(/[\/,，、]+/).map((x) => x.trim()).filter(Boolean))].slice(0, 12);
          }
          const max = el.querySelector(`[data-f-max="${i}"]`)?.value;
          if (max !== undefined) fields[i].max = Number(max);
        });
      };

      const rerenderFields = () => {
        const host = root.querySelector('#fields-host');
        host.innerHTML = fields.length ? fields.map(fieldBlock).join('') : '<div class="field-hint" style="padding:4px 2px">还没有字段。没有字段时，一次点击就是一条记录。</div>';
        bindFields();
      };

      function bindFields() {
        root.querySelectorAll('[data-f-remove]').forEach((btn) =>
          btn.addEventListener('click', () => {
            readFields();
            fields.splice(Number(btn.dataset.fRemove), 1);
            rerenderFields();
          })
        );
        root.querySelectorAll('[data-f-type]').forEach((sel) =>
          sel.addEventListener('change', () => {
            readFields();
            const i = Number(sel.dataset.fType);
            fields[i].type = sel.value;
            if (fields[i].type === 'select' && !fields[i].options?.length) fields[i].options = ['选项一', '选项二'];
            if (fields[i].type === 'rating' && !fields[i].max) fields[i].max = 5;
            rerenderFields();
          })
        );
      }

      bindFields();

      root.querySelector('[data-act="add-field"]').addEventListener('click', () => {
        readFields();
        fields.push({ key: `f${fields.length + 1}`, label: '', type: 'text' });
        rerenderFields();
      });

      root.querySelector('[data-name]').addEventListener('input', (e) => (draft.name = e.target.value));
      root.querySelector('[data-desc]').addEventListener('input', (e) => (draft.description = e.target.value));
      root.querySelector('[data-group]').addEventListener('change', (e) => (draft.groupId = e.target.value));
      root.querySelector('[data-goal]').addEventListener('input', (e) => (draft.goalValue = Number(e.target.value) || 0));
      root.querySelector('[data-goal-period]').addEventListener('change', (e) => (draft.goalPeriod = e.target.value));

      root.addEventListener('click', (e) => {
        const mode = e.target.closest('[data-mode]');
        if (mode) {
          draft.mode = mode.dataset.mode;
          root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === draft.mode));
          return;
        }
        const emoji = e.target.closest('[data-emoji]');
        if (emoji) {
          draft.emoji = emoji.dataset.emoji;
          root.querySelectorAll('[data-emoji]').forEach((b) => b.classList.toggle('on', b.dataset.emoji === draft.emoji));
          return;
        }
        const color = e.target.closest('[data-color]');
        if (color) {
          draft.color = color.dataset.color;
          root.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('on', b.dataset.color === draft.color));
        }
      });

      root.querySelector('[data-act="delete"]')?.addEventListener('click', () => {
        close();
        confirmDelete({
          title: `删除「${template.name}」？`,
          text: `该模板下的 ${template.stats?.total ?? 0} 条记录会一并删除，且无法恢复。`,
          onConfirm: async () => {
            await api.del(`/api/templates/${template.id}`);
            await ctx.loadTemplates();
            ctx.render();
            toast('模板已删除', 'ok');
          },
        });
      });

      root.querySelector('[data-act="save"]').addEventListener('click', async (e) => {
        readFields();
        const name = root.querySelector('[data-name]').value.trim();
        if (!name) return toast('请填写模板名称', 'err');
        for (const f of fields) {
          if (!f.label?.trim()) return toast('请为每个字段填写名称', 'err');
          if (f.type === 'select' && !(f.options || []).length) return toast(`「${f.label}」至少需要一个选项`, 'err');
        }
        const payload = {
          name,
          emoji: draft.emoji,
          color: draft.color,
          mode: draft.mode,
          description: draft.description,
          groupId: draft.groupId === '' ? null : Number(draft.groupId),
          goalValue: draft.goalValue,
          goalPeriod: draft.goalPeriod,
          fields: fields.map((f, i) => ({ ...f, key: f.key || `f${i + 1}` })),
        };
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = '保存中…';
        try {
          if (isNew) await api.post('/api/templates', payload);
          else await api.patch(`/api/templates/${template.id}`, payload);
          close();
          await ctx.loadTemplates();
          ctx.render();
          toast(isNew ? '模板已创建' : '模板已更新', 'ok');
        } catch (err) {
          btn.disabled = false;
          btn.textContent = isNew ? '创建模板' : '保存';
          toast(err.message, 'err');
        }
      });
    },
  });
}

export { closeSheet };
