// 记录 / 打卡 / 计时：三个底部弹层
import { api } from '../api.js';
import { $, esc, fmtDuration, icon, readImageAsDataUrl, relativeTime, toast, todayKey } from '../util.js';
import { closeSheet, emptyState, fieldRow, ring, sheet } from '../components.js';

// ---------------------------------------------------------------- 选择模板
export function openPickerSheet(ctx) {
  const { templates, groups } = ctx.state;

  if (!templates.length) {
    sheet({
      title: '还没有可用的模板',
      body: emptyState({
        iconName: 'grid',
        title: '先去创建一个模板',
        text: '模板决定了要记下哪些内容：文字、数字、选项还是图片。',
        actionLabel: '去创建模板',
        action: 'go-manage',
      }),
      onMount: (root, close) => {
        root.querySelector('[data-act="go-manage"]')?.addEventListener('click', () => {
          close();
          ctx.go('#/manage');
        });
      },
    });
    return;
  }

  const byGroup = new Map();
  for (const t of templates) {
    const key = t.group_id ?? 'none';
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(t);
  }

  const section = (label, list) => `
    <div style="margin-bottom:18px">
      <div class="section-hint" style="margin:0 0 8px 2px">${esc(label)}</div>
      <div class="list">
        ${list
          .map(
            (t) => `<button class="list-row" data-tpl="${t.id}">
              <span class="tl-emoji" style="background:color-mix(in srgb, ${t.color} 16%, transparent)">${esc(t.emoji)}</span>
              <span class="list-main">
                <span class="list-title">${esc(t.name)}</span>
                <span class="list-sub">${t.mode === 'checkin' ? '打卡' : '记录'} · 已有 ${t.stats?.total ?? 0} 条</span>
              </span>
              <span class="list-tail">${icon('right', 'i i-18')}</span>
            </button>`
          )
          .join('')}
      </div>
    </div>`;

  const body = [...byGroup.entries()]
    .map(([gid, list]) => {
      const g = groups.find((x) => x.id === gid);
      return section(g ? g.name : '未分组', list);
    })
    .join('');

  sheet({
    title: '记一笔',
    body,
    onMount: (root, close) => {
      root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tpl]');
        if (!btn) return;
        const tpl = templates.find((t) => t.id === Number(btn.dataset.tpl));
        close();
        if (tpl.mode === 'checkin' && !tpl.fields?.length) openRecordSheet(ctx, tpl);
        else openRecordSheet(ctx, tpl);
      });
    },
  });
}

// ---------------------------------------------------------------- 记录 / 打卡
export function openRecordSheet(ctx, template, existing = null, prefill = {}) {
  const today = todayKey();
  const values = { ...(existing?.values || {}) };
  let day = existing?.day_key || prefill.day || today;
  let tags = [...(existing?.tags || prefill.tags || [])];
  let note = existing?.note || prefill.note || '';
  let error = '';
  let duration = existing?.duration || prefill.duration || 0;

  const fieldControl = (f) => {
    const v = values[f.key];
    if (f.type === 'number') {
      return `<div style="position:relative">
        <input class="input" type="number" inputmode="decimal" step="any" data-field="${f.key}" value="${v ?? ''}" placeholder="${esc(f.placeholder || '0')}" style="padding-right:52px">
        ${f.unit ? `<span style="position:absolute;right:14px;top:50%;transform:translateY(-50%);font-size:12.5px;color:var(--text-3)">${esc(f.unit)}</span>` : ''}
      </div>`;
    }
    if (f.type === 'select') {
      return `<div class="chips" data-select="${f.key}">
        ${(f.options || [])
          .map((o) => `<button type="button" class="chip ${v === o ? 'on' : ''}" data-option="${esc(o)}">${esc(o)}</button>`)
          .join('')}
      </div>`;
    }
    if (f.type === 'rating') {
      const max = f.max || 5;
      return `<div class="stars" data-rate="${f.key}" data-value="${v || 0}">
        ${Array.from({ length: max }, (_, i) => `<button type="button" class="i ${i < (v || 0) ? 'on' : ''}" data-star="${i + 1}">${icon('sparkle')}</button>`).join('')}
      </div>`;
    }
    if (f.type === 'image') {
      const urls = Array.isArray(v) ? v : [];
      return `<div class="img-strip" data-images="${f.key}">
        ${urls.map((u) => `<img class="img-thumb" src="${esc(u)}" alt="">`).join('')}
        <label class="img-add"><input type="file" accept="image/*" hidden data-img="${f.key}">${icon('plus')}</label>
      </div>`;
    }
    return `<input class="input" data-field="${f.key}" value="${esc(v ?? '')}" placeholder="${esc(f.placeholder || '')}" maxlength="200">`;
  };

  const fieldsHtml = (template.fields || []).length
    ? template.fields.map((f) => fieldRow(`${f.label}`, fieldControl(f))).join('')
    : `<div style="font-size:13px;color:var(--text-3);padding:4px 2px">这个模板没有额外字段，直接点保存即可完成一次${template.mode === 'checkin' ? '打卡' : '记录'}。</div>`;

  const body = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">
      <span class="tl-emoji" style="width:46px;height:46px;font-size:22px;background:color-mix(in srgb, ${template.color} 16%, transparent)">${esc(template.emoji)}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:600">${esc(template.name)}</div>
        <div style="font-size:12px;color:var(--text-3)">${template.mode === 'checkin' ? '打卡' : '记录'} · 已累计 ${template.stats?.total ?? 0} 条</div>
      </div>
      ${template.goal_value > 0 ? `<span class="badge badge-brand">目标 ${template.goal_value} 次 / ${{ day: '每天', week: '每周', month: '每月', year: '每年' }[template.goal_period] || '每月'}</span>` : ''}
    </div>

    <div style="display:flex;flex-direction:column;gap:14px">
      ${fieldRow('日期', `<input class="input" type="date" data-day value="${esc(day)}" max="2999-12-31">`, '可以选择过去的日子补记')}
      ${fieldsHtml}
      ${fieldRow('标签', `<input class="input" data-tags value="${esc(tags.join(' '))}" placeholder="空格或逗号分隔，最多 8 个">`)}
      ${fieldRow('补充说明', `<textarea class="textarea" data-note maxlength="1000" placeholder="这条记录本身想补充的话">${esc(note)}</textarea>`)}
      ${duration > 0 ? `<div class="check-row">${icon('timer', 'i i-18')}<span>本次记录时长 <strong>${fmtDuration(duration)}</strong></span></div>` : ''}
      ${error ? `<div class="form-error">${esc(error)}</div>` : ''}
    </div>`;

  const footer = `
    <button class="btn btn-ghost" data-act="cancel">取消</button>
    <button class="btn btn-primary" data-act="save">${existing ? '保存修改' : template.mode === 'checkin' ? '完成打卡' : '保存记录'}</button>`;

  sheet({
    title: existing ? '编辑记录' : template.mode === 'checkin' ? '打卡' : '写一条记录',
    body,
    footer,
    onMount: (root, close) => {
      const readForm = () => {
        day = root.querySelector('[data-day]').value || today;
        const tagRaw = root.querySelector('[data-tags]').value;
        tags = [...new Set(tagRaw.split(/[\s,，、]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean))].slice(0, 8);
        note = root.querySelector('[data-note]').value;
        for (const f of template.fields || []) {
          if (f.type === 'select' || f.type === 'rating' || f.type === 'image') continue;
          const el = root.querySelector(`[data-field="${f.key}"]`);
          if (!el) continue;
          if (el.value === '') delete values[f.key];
          else values[f.key] = el.value;
        }
      };

      root.addEventListener('click', (e) => {
        const opt = e.target.closest('[data-option]');
        if (opt) {
          const wrap = opt.closest('[data-select]');
          wrap.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
          opt.classList.add('on');
          values[wrap.dataset.select] = opt.dataset.option;
          return;
        }
        const star = e.target.closest('[data-star]');
        if (star) {
          const wrap = star.closest('[data-rate]');
          const n = Number(star.dataset.star);
          values[wrap.dataset.rate] = n;
          wrap.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i < n));
        }
      });

      root.addEventListener('change', async (e) => {
        const input = e.target.closest('[data-img]');
        if (!input || !input.files?.[0]) return;
        const key = input.dataset.img;
        const file = input.files[0];
        try {
          const dataUrl = await readImageAsDataUrl(file);
          const res = await api.post('/api/uploads', { dataUrl });
          values[key] = [...(Array.isArray(values[key]) ? values[key] : []), res.url].slice(0, 6);
          const strip = input.closest('[data-images]');
          const img = document.createElement('img');
          img.className = 'img-thumb';
          img.src = res.url;
          strip.insertBefore(img, strip.querySelector('.img-add'));
        } catch (err) {
          toast(err.message, 'err');
        }
      });

      root.querySelector('[data-act="cancel"]')?.addEventListener('click', close);
      root.querySelector('[data-act="save"]')?.addEventListener('click', async (e) => {
        readForm();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          error = '日期格式不正确';
          return toast(error, 'err');
        }
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = '保存中…';
        try {
          const payload = { templateId: template.id, day, values, tags, note, duration };
          if (existing) await api.patch(`/api/entries/${existing.id}`, payload);
          else await api.post('/api/entries', payload);
          close();
          toast(existing ? '已保存修改' : template.mode === 'checkin' ? '打卡成功' : '记录已保存', 'ok');
          const { reloadAll } = await import('../app.js');
          await reloadAll();
          ctx.render();
        } catch (err) {
          error = err.message;
          btn.disabled = false;
          btn.textContent = existing ? '保存修改' : '保存';
          toast(err.message, 'err');
        }
      });
    },
  });
}

// ---------------------------------------------------------------- 计时器
export function openTimerSheet(ctx, template) {
  const PRESETS = [5, 15, 25, 45, 60];
  let targetMin = Number(localStorage.getItem('nianlun.timerTarget')) || 25;
  let elapsed = 0;
  let running = false;
  let ticker = null;

  const draw = (root) => {
    const p = Math.min(1, elapsed / (targetMin * 60));
    root.innerHTML = `
      <div class="timer-stage">
        <div class="chips" style="justify-content:center">
          ${PRESETS.map((m) => `<button class="chip ${m === targetMin ? 'on' : ''}" data-preset="${m}">${m} 分钟</button>`).join('')}
        </div>
        ${ring({
          size: 230,
          stroke: 14,
          progress: p,
          ticks: true,
          color: running ? 'var(--accent)' : 'var(--brand)',
          center: `<div>
            <div style="font-size:34px;font-weight:600;letter-spacing:-.03em;font-variant-numeric:tabular-nums">${fmtDuration(elapsed)}</div>
            <div class="ring-sub" style="margin-top:2px">目标 ${targetMin} 分钟 · ${Math.round(p * 100)}%</div>
          </div>`,
        })}
        <div class="timer-actions">
          <button class="timer-btn sub" data-act="reset" aria-label="重置">${icon('refresh')}</button>
          <button class="timer-btn main" data-act="toggle" aria-label="${running ? '暂停' : '开始'}">${icon(running ? 'pause' : 'play', 'i i-28')}</button>
          <button class="timer-btn sub" data-act="finish" aria-label="结束并记录">${icon('check')}</button>
        </div>
        <div class="timer-hint">${running ? '计时进行中…' : elapsed > 0 ? '点击左侧重置，或点击右侧结束并写入记录' : '选择目标时长后开始计时'}</div>
      </div>`;
  };

  sheet({
    title: `计时 · ${template.name}`,
    body: '<div id="timer-host"></div>',
    onMount: (root, close) => {
      const host = root.querySelector('#timer-host');
      draw(host);

      const stop = () => {
        if (ticker) clearInterval(ticker);
        ticker = null;
        running = false;
      };

      host.addEventListener('click', async (e) => {
        const preset = e.target.closest('[data-preset]');
        if (preset) {
          targetMin = Number(preset.dataset.preset);
          localStorage.setItem('nianlun.timerTarget', String(targetMin));
          draw(host);
          return;
        }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'toggle') {
          running = !running;
          if (running) {
            const startedAt = Date.now() - elapsed * 1000;
            ticker = setInterval(() => {
              const before = elapsed;
              elapsed = Math.floor((Date.now() - startedAt) / 1000);
              if (Math.floor(before / 60) !== Math.floor(elapsed / 60)) draw(host);
              else {
                const digits = host.querySelector('.ring-label div div');
                if (digits) digits.textContent = fmtDuration(elapsed);
              }
              if (elapsed === targetMin * 60) {
                toast(`已完成 ${targetMin} 分钟`, 'ok');
                navigator.vibrate?.([40, 60, 40]);
              }
            }, 250);
          } else {
            stop();
          }
          draw(host);
          return;
        }
        if (act === 'reset') {
          stop();
          elapsed = 0;
          draw(host);
          return;
        }
        if (act === 'finish') {
          stop();
          if (elapsed < 1) {
            toast('还没有计时，先开始吧', 'err');
            return;
          }
          const seconds = elapsed;
          close();
          openRecordSheet(ctx, template, null, { duration: seconds });
        }
      });

      const onClose = root.querySelector('[data-close]');
      onClose?.addEventListener('click', stop);
      sheetStop = stop;
    },
  });
}

/** 供外部在关闭弹层时停掉计时器 */
let sheetStop = null;
export function stopTimer() {
  sheetStop?.();
  sheetStop = null;
}
