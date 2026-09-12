// 今日：分组胶囊标签 + 模板卡片流（三指标 / 小环形 / 月点阵 / 打卡按钮）
import { api } from '../api.js';
import { $, dayLabel, esc, icon, relativeTime, todayKey } from '../util.js';
import { pageShell } from '../shell.js';
import { emptyState, metricsRow, monthMatrix, ring } from '../components.js';
import { openRecordSheet, openTimerSheet } from './record.js';
import { openTemplateSheet } from './template.js';

function cardFor(t, state) {
  const s = t.stats || { total: 0, days: 0, streak: 0, goal: { value: 0, percent: null } };
  const goalPct = s.goal?.percent;
  const goalLabel = { day: '每天', week: '每周', month: '本月', year: '今年' }[s.goal?.period] || '本月';
  const last = s.lastDay ? `上次 ${dayLabel(s.lastDay, state.today)}` : '还没有记录';
  const doneToday = s.lastDay === state.today;

  return `<article class="tpl-card" data-tpl-card="${t.id}">
    <div class="tpl-top">
      <span class="tpl-emoji" style="background:color-mix(in srgb, ${t.color} 16%, transparent)">${esc(t.emoji)}</span>
      <div style="flex:1;min-width:0">
        <div class="tpl-name">${esc(t.name)}</div>
        <div class="tpl-meta">${esc(last)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        ${
          goalPct === null
            ? `<span class="badge">${s.total} 条</span>`
            : ring({
                size: 46,
                stroke: 5,
                progress: goalPct / 100,
                color: t.color,
                center: `<div style="font-size:11px;font-weight:600">${goalPct}%</div>`,
              })
        }
        <button class="icon-btn" data-card-menu="${t.id}" aria-label="更多">${icon('more', 'i i-18')}</button>
      </div>
    </div>

    <div class="tpl-body">
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px">
        ${metricsRow(s)}
        ${
          t.goal_value > 0
            ? `<div>
                <div class="progress-bar">${`<div class="progress-fill" style="width:${goalPct ?? 0}%;background:${t.color}"></div>`}</div>
                <div style="font-size:11.5px;color:var(--text-3);margin-top:5px">${goalLabel}已完成 ${s.goal.count} / ${t.goal_value} 次</div>
              </div>`
            : `<div style="font-size:11.5px;color:var(--text-3)">${s.avgGap ? `平均 ${s.avgGap} 天一次` : '记满两次后开始统计间隔'}</div>`
        }
      </div>
      <div class="tpl-right">
        ${monthMatrix({ month: state.today.slice(0, 7), counts: s.monthDays || {}, today: state.today, weekStartsOn: state.weekStartsOn })}
        <div style="display:flex;gap:6px">
          ${t.mode === 'checkin' ? `<button class="pill-btn ${doneToday ? 'done' : ''}" data-quick="${t.id}">${icon(doneToday ? 'check' : 'plus', 'i i-16')}${doneToday ? '已打卡' : '打卡'}</button>` : `<button class="pill-btn muted" data-quick="${t.id}">${icon('plus', 'i i-16')}记录</button>`}
          <button class="pill-btn muted" data-timer="${t.id}" aria-label="计时">${icon('timer', 'i i-16')}</button>
        </div>
      </div>
    </div>
  </article>`;
}

export async function render(root, ctx, { active }) {
  const s = ctx.state;
  const [overview] = await Promise.all([api.get(`/api/stats/overview?today=${s.today}`)]);
  const stats = overview.stats;

  const templates = s.templates || [];
  const groups = s.groups || [];
  const activeGroup = s.activeGroup;
  const ungrouped = templates.filter((t) => !t.group_id).length;

  const list =
    activeGroup === 'all'
      ? templates
      : activeGroup === 'none'
        ? templates.filter((t) => !t.group_id)
        : templates.filter((t) => String(t.group_id) === String(activeGroup));

  const chip = (key, label, count) =>
    `<button class="chip ${String(activeGroup) === String(key) ? 'on' : ''}" data-group="${key}">${esc(label)}${count !== undefined ? `<span style="opacity:.6">${count}</span>` : ''}</button>`;

  const body = `
    <div class="grid-3" style="margin-bottom:6px">
      <div class="stat-card"><div class="k">今天记了</div><div class="v">${stats.todayCount}<small>条</small></div></div>
      <div class="stat-card"><div class="k">当前连续</div><div class="v">${stats.streak}<small>天</small></div></div>
      <div class="stat-card"><div class="k">本月累计</div><div class="v">${stats.monthCount}<small>条</small></div></div>
      <div class="stat-card"><div class="k">总计</div><div class="v">${stats.totalEntries}<small>条 / ${stats.totalDays} 天</small></div></div>
    </div>

    <div class="chips" style="margin-top:16px">
      ${chip('all', '全部', templates.length)}
      ${groups.map((g) => chip(g.id, g.name, g.templateCount)).join('')}
      ${ungrouped ? chip('none', '未分组', ungrouped) : ''}
      <button class="chip chip-add" data-act="new-template">${icon('plus', 'i i-16')}新建</button>
    </div>

    ${
      list.length
        ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;margin-top:6px">
            ${list.map((t) => cardFor(t, s)).join('')}
          </div>`
        : emptyState({
            iconName: 'grid',
            title: templates.length ? '这个分组还没有模板' : '还没有任何记录模板',
            text: templates.length ? '把模板拖到别的分组，或者新建一个。' : '模板决定要记下什么：跑步的公里数、读书的页数，或者一天的心情。',
            actionLabel: '创建第一个模板',
            action: 'new-template',
          })
    }
    <div style="height:20px"></div>`;

  root.innerHTML = pageShell(s, {
    title: '今日',
    subtitle: dayLabel(s.today, s.today) + ' · ' + s.today,
    active,
    actions: `<button class="icon-btn" data-act="new-template" title="新建模板">${icon('plus')}</button>`,
    body,
  });

  // ---- 交互 ----
  const byId = (id) => templates.find((t) => t.id === Number(id));

  root.querySelectorAll('[data-group]').forEach((el) =>
    el.addEventListener('click', () => {
      ctx.setActiveGroup(el.dataset.group);
      ctx.render();
    })
  );

  root.querySelectorAll('[data-act="new-template"]').forEach((el) =>
    el.addEventListener('click', async () => {
      const { openTemplateEditor } = await import('./manage.js');
      openTemplateEditor(ctx);
    })
  );

  root.querySelectorAll('[data-quick]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openRecordSheet(ctx, byId(el.dataset.quick));
    })
  );

  root.querySelectorAll('[data-timer]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openTimerSheet(ctx, byId(el.dataset.timer));
    })
  );

  root.querySelectorAll('[data-card-menu]').forEach((el) =>
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const t = byId(el.dataset.cardMenu);
      const { openMenu, confirmDelete } = await import('../components.js');
      openMenu(el, [
        { label: '查看详情', icon: 'chart', onSelect: () => openTemplateSheet(ctx, t) },
        { label: '编辑模板', icon: 'edit', onSelect: async () => (await import('./manage.js')).openTemplateEditor(ctx, t) },
        {
          label: '归档模板',
          icon: 'archive',
          onSelect: async () => {
            await api.patch(`/api/templates/${t.id}`, { archived: true });
            await ctx.loadTemplates();
            ctx.render();
          },
        },
        {
          label: '删除模板',
          icon: 'trash',
          danger: true,
          onSelect: () =>
            confirmDelete({
              title: `删除「${t.name}」？`,
              text: '这个模板下的所有记录都会一起删除，无法撤销。',
              onConfirm: async () => {
                const res = await api.del(`/api/templates/${t.id}`);
                await ctx.loadTemplates();
                ctx.render();
                const { toast } = await import('../util.js');
                toast(`已删除，同时移除 ${res.deletedEntries} 条记录`, 'ok');
              },
            }),
        },
      ]);
    })
  );

  root.querySelectorAll('[data-tpl-card]').forEach((el) =>
    el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openTemplateSheet(ctx, byId(el.dataset.tplCard));
    })
  );
}

export { relativeTime, todayKey };
