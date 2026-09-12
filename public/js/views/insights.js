// 洞察：概览指标 / 时间分配环形图 / 趋势折线 / 年度热力图 / 标签统计
import { api } from '../api.js';
import { $, esc, icon, todayKey } from '../util.js';
import { pageShell } from '../shell.js';
import { donut, donutBlock, emptyState, heatmapYear, legend, trendChart } from '../components.js';

const PERIODS = [
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
  { key: 'year', label: '年' },
  { key: 'all', label: '全部' },
];

export async function render(root, ctx, { active }) {
  const s = ctx.state;
  const today = s.today || todayKey();
  let period = localStorage.getItem('nianlun.period') || 'month';
  let tagName = null;
  let year = Number(today.slice(0, 4));

  const load = async () => {
    const q = `today=${today}&weekStartsOn=${s.weekStartsOn}&period=${period}`;
    const [overview, dist, trend, heat, tags] = await Promise.all([
      api.get(`/api/stats/overview?today=${today}&weekStartsOn=${s.weekStartsOn}`),
      api.get(`/api/stats/distribution?${q}`),
      api.get(`/api/stats/trend?${q}`),
      api.get(`/api/stats/heatmap?year=${year}`),
      api.get(`/api/stats/tags?${q}`),
    ]);
    return {
      stats: overview.stats,
      dist,
      trend,
      heat,
      tags: tags.tags || [],
      range: { from: dist.from, to: dist.to },
    };
  };

  let data = await load();

  const draw = () => {
    const { stats, dist, trend, heat, tags, range } = data;
    const activeTag = tagName ? tags.find((t) => t.name === tagName) : null;

    const distItems = dist.items.map((it) => ({ name: it.name, count: it.count, percent: it.percent, color: it.color }));

    const body = `
      <div class="segment" style="max-width:340px">
        ${PERIODS.map((p) => `<button data-period="${p.key}" class="${p.key === period ? 'on' : ''}">${p.label}</button>`).join('')}
      </div>
      <div class="section-hint" style="margin-top:8px">统计区间 ${esc(range.from)} → ${esc(range.to)}</div>

      <div class="grid-3" style="margin-top:16px">
        <div class="stat-card"><div class="k">记录总数</div><div class="v">${dist.total}<small>条</small></div></div>
        <div class="stat-card"><div class="k">记录天数</div><div class="v">${stats.totalDays}<small>天</small></div></div>
        <div class="stat-card"><div class="k">当前连续</div><div class="v">${stats.streak}<small>天</small></div></div>
        <div class="stat-card"><div class="k">活跃模板</div><div class="v">${stats.activeTemplates}<small>个</small></div></div>
      </div>

      <div class="section">
        <div class="section-head">
          <div class="section-title">时间分配</div>
          <div class="section-hint">按模板拆分</div>
        </div>
        <div class="card">
          ${distItems.length ? donutBlock(distItems) : emptyState({ iconName: 'chart', title: '这个区间还没有记录', text: '换个时间范围，或者先去记一笔。' })}
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <div class="section-title">记录趋势</div>
          <div class="section-hint">${trend.granularity === 'week' ? '按周聚合' : '按天'} · 共 ${trend.total} 条</div>
        </div>
        <div class="card">${trendChart(trend.points, { label: trend.granularity === 'week' ? '每周' : '每天' })}</div>
      </div>

      <div class="section">
        <div class="section-head">
          <div class="section-title">年度热力图</div>
          <div style="display:flex;align-items:center;gap:2px">
            <button class="icon-btn" data-year="-1" aria-label="上一年">${icon('left', 'i i-18')}</button>
            <button class="icon-btn" data-year="1" aria-label="下一年">${icon('right', 'i i-18')}</button>
          </div>
        </div>
        <div class="card">${heatmapYear({ year, counts: heat.counts, today, weekStartsOn: s.weekStartsOn })}</div>
      </div>

      <div class="section">
        <div class="section-head">
          <div class="section-title">标签统计</div>
          <div class="section-hint">${tags.length} 个标签</div>
        </div>
        ${
          tags.length
            ? `<div class="chips" style="margin-bottom:12px">
                ${tags.map((t) => `<button class="chip ${activeTag?.name === t.name ? 'on' : ''}" data-tag="${esc(t.name)}">#${esc(t.name)}<span style="opacity:.6">${t.count}</span></button>`).join('')}
              </div>
              ${
                activeTag
                  ? `<div class="grid-3" style="margin-bottom:12px">
                      <div class="stat-card"><div class="k">记录总数</div><div class="v">${activeTag.count}<small>条</small></div></div>
                      <div class="stat-card"><div class="k">模板数量</div><div class="v">${activeTag.templates.length}<small>个</small></div></div>
                      <div class="stat-card"><div class="k">使用天数</div><div class="v">${activeTag.days}<small>天</small></div></div>
                      <div class="stat-card"><div class="k">首次使用</div><div class="v" style="font-size:16px;padding-top:6px">${esc(activeTag.firstDay)}</div></div>
                      <div class="stat-card"><div class="k">最近使用</div><div class="v" style="font-size:16px;padding-top:6px">${esc(activeTag.lastDay)}</div></div>
                    </div>
                    <div class="card">
                      <div class="section-hint" style="margin-bottom:12px">按模板分布</div>
                      <div class="donut-wrap">
                        ${donut(activeTag.templates.map((t) => ({ name: t.name, count: t.count, percent: t.percent, color: t.color })))}
                        <div class="donut-legend">${legend(activeTag.templates.map((t) => ({ name: t.name, count: t.count, percent: t.percent, color: t.color })))}</div>
                      </div>
                    </div>`
                  : `<div class="card"><div class="section-hint">选择一个标签，查看它在不同模板之间的分布</div>
                      <div style="margin-top:14px;display:flex;flex-direction:column;gap:10px">
                        ${tags
                          .slice(0, 8)
                          .map(
                            (t) => `<div class="legend-row">
                              <span class="legend-dot" style="background:var(--brand)"></span>
                              <span class="legend-name">#${esc(t.name)}</span>
                              <span class="legend-val">${t.count} 条 · ${t.days} 天 · ${t.templates.length} 个模板</span>
                            </div>`
                          )
                          .join('')}
                      </div>
                    </div>`
              }`
            : `<div class="card">${emptyState({ iconName: 'tag', title: '还没有使用标签', text: '在写记录时加上标签，之后就能跨模板聚合统计。' })}</div>`
        }
      </div>
      <div style="height:20px"></div>`;

    root.innerHTML = pageShell(s, {
      title: '洞察',
      subtitle: '看清时间都花在了哪里',
      active,
      actions: `<button class="icon-btn" data-act="reload" title="刷新">${icon('refresh')}</button>`,
      body,
    });
    bind();
  };

  function bind() {
    root.querySelectorAll('[data-period]').forEach((el) =>
      el.addEventListener('click', async () => {
        period = el.dataset.period;
        localStorage.setItem('nianlun.period', period);
        data = await load();
        draw();
      })
    );

    root.querySelectorAll('[data-year]').forEach((el) =>
      el.addEventListener('click', async () => {
        year += Number(el.dataset.year);
        const heat = await api.get(`/api/stats/heatmap?year=${year}`);
        data = { ...data, heat };
        draw();
      })
    );

    root.querySelectorAll('[data-tag]').forEach((el) =>
      el.addEventListener('click', () => {
        tagName = tagName === el.dataset.tag ? null : el.dataset.tag;
        draw();
      })
    );

    root.querySelector('[data-act="reload"]')?.addEventListener('click', async () => {
      data = await load();
      draw();
    });
  }

  draw();
}
