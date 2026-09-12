// 模板详情弹层：指标 / 目标进度 / 圆点日历 / 最近记录
import { api } from '../api.js';
import { $, dayLabel, esc, fmtClock, icon, monthLabel, shiftMonth, todayKey } from '../util.js';
import { closeSheet, dotCalendar, emptyState, metricsRow, ring, sheet } from '../components.js';
import { openRecordSheet, openTimerSheet } from './record.js';

function describe(entry, template) {
  const parts = [];
  for (const f of template.fields || []) {
    const v = entry.values?.[f.key];
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (f.type === 'image') parts.push(`${f.label} ${v.length} 张`);
    else if (f.type === 'number') parts.push(`${f.label} ${v}${f.unit || ''}`);
    else if (f.type === 'rating') parts.push(`${f.label} ${v}/${f.max || 5}`);
    else parts.push(String(v));
    if (parts.length >= 3) break;
  }
  if (entry.note) parts.push(entry.note);
  if (entry.duration > 0) parts.unshift(`计时 ${Math.round(entry.duration / 60)} 分钟`);
  return parts.join(' · ') || '—';
}

export async function openTemplateSheet(ctx, template) {
  const today = todayKey();
  let month = today.slice(0, 7);
  let calCounts = {};
  let entries = [];
  let stats = template.stats || {};

  const load = async () => {
    const [cal, list, detail] = await Promise.all([
      api.get(`/api/templates/${template.id}/calendar?month=${month}`),
      api.get(`/api/entries?templateId=${template.id}&limit=12`),
      api.get(`/api/templates/${template.id}?today=${today}&weekStartsOn=${ctx.state.weekStartsOn}`),
    ]);
    calCounts = cal.counts || {};
    entries = list.entries || [];
    stats = detail.template.stats || stats;
  };

  await load().catch(() => {});

  const goalLabel = { day: '每天', week: '每周', month: '每月', year: '每年' }[stats.goal?.period] || '每月';

  const body = () => `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
      <span class="tl-emoji" style="width:54px;height:54px;font-size:26px;border-radius:16px;background:color-mix(in srgb, ${template.color} 16%, transparent)">${esc(template.emoji)}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:17px;font-weight:600;letter-spacing:-.01em">${esc(template.name)}</div>
        <div style="font-size:12.5px;color:var(--text-3)">${esc(template.description || (template.mode === 'checkin' ? '打卡型模板' : '记录型模板'))}</div>
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
          <span class="badge badge-brand">${template.mode === 'checkin' ? '打卡' : '记录'}</span>
          ${stats.firstDay ? `<span class="badge">始于 ${esc(stats.firstDay)}</span>` : ''}
          ${stats.avgGap ? `<span class="badge">平均间隔 ${stats.avgGap} 天</span>` : ''}
        </div>
      </div>
    </div>

    <div class="card" style="background:var(--surface-2);box-shadow:none;padding:16px;margin-bottom:16px">
      ${metricsRow(stats, { withGap: false })}
    </div>

    ${
      template.goal_value > 0
        ? `<div class="card" style="box-shadow:none;background:var(--surface-2);padding:16px;margin-bottom:16px">
            <div style="display:flex;align-items:center;gap:16px">
              ${ring({ size: 92, stroke: 9, progress: (stats.goal?.percent ?? 0) / 100, color: template.color, center: `<div><div class="ring-percent">${stats.goal?.percent ?? 0}%</div><div class="ring-sub">${goalLabel}</div></div>` })}
              <div style="flex:1">
                <div style="font-size:14px;font-weight:600">目标进度</div>
                <div style="font-size:12.5px;color:var(--text-2);margin-top:3px">${goalLabel}已完成 ${stats.goal?.count ?? 0} / ${template.goal_value} 次</div>
                <div class="progress-bar" style="margin-top:10px"><div class="progress-fill" style="width:${stats.goal?.percent ?? 0}%;background:${template.color}"></div></div>
              </div>
            </div>
          </div>`
        : ''
    }

    <div class="section-head">
      <div class="section-title">打卡日历</div>
      <div style="display:flex;align-items:center;gap:2px">
        <button class="icon-btn" data-nav="-1" aria-label="上个月">${icon('left', 'i i-18')}</button>
        <span style="font-size:13px;min-width:88px;text-align:center">${esc(monthLabel(month))}</span>
        <button class="icon-btn" data-nav="1" aria-label="下个月">${icon('right', 'i i-18')}</button>
      </div>
    </div>
    <div class="card" style="box-shadow:none;background:var(--surface-2);padding:14px">
      ${dotCalendar({ month, counts: calCounts, today, weekStartsOn: ctx.state.weekStartsOn })}
      <div style="font-size:12px;color:var(--text-3);margin-top:12px;text-align:center">本月 ${Object.values(calCounts).reduce((s, v) => s + v, 0)} 次 · 点击日期可补记</div>
    </div>

    <div class="section-head" style="margin-top:22px">
      <div class="section-title">最近记录</div>
      <div class="section-hint">${entries.length} 条</div>
    </div>
    ${
      entries.length
        ? `<div class="list">${entries
            .map(
              (e) => `<button class="list-row" data-entry="${e.id}">
                <span class="list-icon">${icon('clock', 'i i-18')}</span>
                <span class="list-main">
                  <span class="list-title">${esc(dayLabel(e.day_key, today))}</span>
                  <span class="list-sub">${esc(describe(e, template))}</span>
                  ${e.tags?.length ? `<span class="tl-tags">${e.tags.map((t) => `<span class="tag-pill">#${esc(t)}</span>`).join('')}</span>` : ''}
                </span>
                <span class="list-tail">${esc(fmtClock(e.occurred_at))}</span>
              </button>`
            )
            .join('')}</div>`
        : emptyState({ iconName: 'clock', title: '还没有记录', text: '第一条记录之后，这里会变成你的时间轴。' })
    }
    <div style="height:8px"></div>`;

  sheet({
    title: '模板详情',
    wide: true,
    body: body(),
    footer: `
      <button class="btn btn-ghost" data-act="edit">${icon('edit', 'i i-18')}编辑</button>
      <button class="btn btn-ghost" data-act="timer">${icon('timer', 'i i-18')}计时</button>
      <button class="btn btn-primary" data-act="add">${icon('plus', 'i i-18')}${template.mode === 'checkin' ? '打卡' : '记录'}</button>`,
    onMount: async (root, close) => {
      const rerender = async () => {
        const scroll = root.querySelector('.sheet-body').scrollTop;
        root.querySelector('.sheet-body').innerHTML = body();
        root.querySelector('.sheet-body').scrollTop = scroll;
        bind();
      };

      async function bind() {
        root.querySelectorAll('[data-nav]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            month = shiftMonth(month, Number(btn.dataset.nav));
            await load().catch(() => {});
            await rerender();
          })
        );

        root.querySelectorAll('.dot-cal-dot[data-day]').forEach((dot) =>
          dot.addEventListener('click', () => {
            openRecordSheet(ctx, template, null, { day: dot.dataset.day });
          })
        );

        root.querySelectorAll('[data-entry]').forEach((row) =>
          row.addEventListener('click', () => {
            const entry = entries.find((e) => e.id === Number(row.dataset.entry));
            if (entry) openRecordSheet(ctx, template, entry);
          })
        );

        root.querySelector('[data-act="edit"]')?.addEventListener('click', async () => {
          const { openTemplateEditor } = await import('./manage.js');
          close();
          openTemplateEditor(ctx, template);
        });
        root.querySelector('[data-act="timer"]')?.addEventListener('click', () => {
          close();
          openTimerSheet(ctx, template);
        });
        root.querySelector('[data-act="add"]')?.addEventListener('click', () => {
          close();
          openRecordSheet(ctx, template);
        });
      }

      await bind();
    },
  });
}

export { closeSheet };
