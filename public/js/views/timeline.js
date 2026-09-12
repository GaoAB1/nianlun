// 时间线：按天分组的记录流 + 搜索 / 标签 / 日期范围筛选
import { api } from '../api.js';
import { $, dayLabel, debounce, esc, fmtClock, icon, monthLabel, todayKey } from '../util.js';
import { pageShell } from '../shell.js';
import { emptyState } from '../components.js';
import { openRecordSheet } from './record.js';

const PAGE = 40;

function describe(entry, tpl) {
  const parts = [];
  for (const f of tpl?.fields || []) {
    const v = entry.values?.[f.key];
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (f.type === 'image') parts.push(`${(v.length && v.length) || 0} 张图`);
    else if (f.type === 'number') parts.push(`${v}${f.unit || ''}`);
    else if (f.type === 'rating') parts.push(`${v}/${f.max || 5}`);
    else parts.push(String(v));
  }
  if (entry.duration > 0) parts.unshift(`${Math.round(entry.duration / 60)} 分钟`);
  if (entry.note) parts.push(entry.note);
  return parts.join(' · ');
}

export async function render(root, ctx, { active }) {
  const s = ctx.state;
  const today = todayKey();

  let offset = 0;
  let entries = [];
  let total = 0;
  const filter = { tag: '', q: '', from: '', to: '' };

  const load = async (reset = true) => {
    const qs = new URLSearchParams({ limit: String(PAGE) });
    if (filter.tag) qs.set('tag', filter.tag);
    if (filter.q) qs.set('q', filter.q);
    if (filter.from) qs.set('from', filter.from);
    if (filter.to) qs.set('to', filter.to);
    if (!reset) qs.set('offset', String(offset));
    const res = await api.get(`/api/entries?${qs.toString()}`);
    if (reset) {
      entries = res.entries;
      offset = res.entries.length;
    } else {
      entries = [...entries, ...res.entries];
      offset += res.entries.length;
    }
    total = res.total;
    return res.hasMore;
  };

  await load(true);
  if (!s.tags.length) await ctx.loadTags().catch(() => {});
  const tags = s.tags || [];

  const tplById = new Map(s.templates.map((t) => [t.id, t]));

  const listHtml = () => {
    if (!entries.length) {
      return emptyState({
        iconName: 'timeline',
        title: '这段时间还没有记录',
        text: filter.tag || filter.q ? '试试换个关键词或清空筛选。' : '从「今日」页面点一下打卡，第一条记录就出现了。',
      });
    }
    const buckets = [];
    for (const e of entries) {
      const last = buckets[buckets.length - 1];
      if (!last || last.day !== e.day_key) buckets.push({ day: e.day_key, items: [e] });
      else last.items.push(e);
    }
    return buckets
      .map(
        (b) => `<section class="tl-day">
          <div class="tl-day-head">
            <span class="tl-day-title">${esc(dayLabel(b.day, today))}</span>
            <span class="tl-day-sub">${b.items.length} 条</span>
          </div>
          <div class="tl-items">
            ${b.items
              .map(
                (e) => `<div class="tl-item" data-entry="${e.id}">
                  <span class="tl-emoji" style="background:color-mix(in srgb, ${e.templateColor} 16%, transparent)">${esc(e.templateEmoji)}</span>
                  <span class="tl-main">
                    <span class="tl-name">${esc(e.templateName)}</span>
                    ${describe(e, tplById.get(e.template_id)) ? `<span class="tl-desc">${esc(describe(e, tplById.get(e.template_id)))}</span>` : ''}
                    ${e.tags?.length ? `<span class="tl-tags">${e.tags.map((t) => `<span class="tag-pill">#${esc(t)}</span>`).join('')}</span>` : ''}
                  </span>
                  <span class="tl-time">${esc(fmtClock(e.occurred_at))}</span>
                </div>`
              )
              .join('')}
          </div>
        </section>`
      )
      .join('');
  };

  const body = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <div class="search-box" style="min-width:220px">
        ${icon('search', 'i i-18')}
        <input class="input" placeholder="搜索备注或内容…" data-q value="${esc(filter.q)}">
      </div>
      <input class="input" type="date" data-from value="${esc(filter.from)}" style="flex:1;min-width:132px" title="起始日期">
      <input class="input" type="date" data-to value="${esc(filter.to)}" style="flex:1;min-width:132px" title="结束日期">
      <button class="btn btn-ghost btn-sm" data-act="clear-filter">清空筛选</button>
    </div>

    ${
      tags.length
        ? `<div class="chips" style="margin-top:12px">
            <button class="chip ${!filter.tag ? 'on' : ''}" data-tag="">全部标签</button>
            ${tags.slice(0, 14).map((t) => `<button class="chip ${filter.tag === t.name ? 'on' : ''}" data-tag="${esc(t.name)}">#${esc(t.name)}<span style="opacity:.6">${t.count}</span></button>`).join('')}
          </div>`
        : ''
    }

    <div class="section-head" style="margin-top:20px">
      <div class="section-title">共 ${total} 条记录</div>
      <div class="section-hint">${filter.tag ? `标签 #${esc(filter.tag)}` : ''}${filter.from || filter.to ? ` ${esc(filter.from || '…')} → ${esc(filter.to || '…')}` : ''}</div>
    </div>

    <div id="tl-list">${listHtml()}</div>

    <div style="text-align:center;margin-top:22px" id="tl-more">
      ${offset < total ? `<button class="btn btn-ghost" data-act="more">加载更多（还有 ${total - offset} 条）</button>` : total ? '<span class="section-hint">已经到底了</span>' : ''}
    </div>`;

  root.innerHTML = pageShell(s, {
    title: '时间线',
    subtitle: monthLabel(today.slice(0, 7)),
    active,
    actions: `<button class="icon-btn" data-act="refresh" title="刷新">${icon('refresh')}</button>`,
    body,
  });

  const refreshList = () => {
    root.querySelector('#tl-list').innerHTML = listHtml();
    root.querySelector('#tl-more').innerHTML =
      offset < total ? `<button class="btn btn-ghost" data-act="more">加载更多（还有 ${total - offset} 条）</button>` : total ? '<span class="section-hint">已经到底了</span>' : '';
    bindList();
  };

  const onSearch = debounce(async () => {
    await load(true);
    refreshList();
  }, 320);

  function bindList() {
    root.querySelectorAll('[data-entry]').forEach((el) =>
      el.addEventListener('click', () => {
        const entry = entries.find((e) => e.id === Number(el.dataset.entry));
        const tpl = tplById.get(entry?.template_id);
        if (entry && tpl) openRecordSheet(ctx, tpl, entry);
      })
    );
    root.querySelectorAll('[data-act="more"]').forEach((el) =>
      el.addEventListener('click', async () => {
        el.disabled = true;
        await load(false);
        refreshList();
      })
    );
  }

  bindList();

  root.querySelectorAll('[data-tag]').forEach((el) =>
    el.addEventListener('click', async () => {
      filter.tag = el.dataset.tag;
      root.querySelectorAll('[data-tag]').forEach((c) => c.classList.toggle('on', c.dataset.tag === filter.tag));
      await load(true);
      refreshList();
    })
  );

  root.querySelector('[data-q]')?.addEventListener('input', (e) => {
    filter.q = e.target.value.trim();
    onSearch();
  });

  ['from', 'to'].forEach((k) => {
    root.querySelector(`[data-${k}]`)?.addEventListener('change', async (e) => {
      filter[k] = e.target.value;
      await load(true);
      refreshList();
    });
  });

  root.querySelector('[data-act="clear-filter"]')?.addEventListener('click', async () => {
    Object.assign(filter, { tag: '', q: '', from: '', to: '' });
    await load(true);
    ctx.render();
  });

  root.querySelector('[data-act="refresh"]')?.addEventListener('click', async () => {
    await Promise.all([load(true), ctx.loadTags().catch(() => {})]);
    ctx.render();
  });
}
