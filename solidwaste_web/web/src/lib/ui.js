// Small browser helpers shared by the pages (the PHP version's ECollect object).

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Current value of a CSS colour token, e.g. color('st-done'). */
export function color(name) {
  return getComputedStyle(document.body).getPropertyValue(`--${name}`).trim();
}

export function toast(message, type) {
  let box = document.querySelector('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = `toast${type === 'error' ? ' error' : ''}`;
  t.textContent = message;
  box.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

/** Promise<boolean> confirm dialog: confirmDialog({ title, message, action, danger }). */
export function confirmDialog(opts) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm';
    dlg.innerHTML = '<div class="dlg-body"><h2></h2><p></p></div><div class="dlg-actions">'
      + '<button type="button" class="btn btn-ghost" data-v="0">Cancel</button>'
      + `<button type="button" class="btn ${opts.danger === false ? 'btn-primary' : 'btn-danger'}" data-v="1"></button></div>`;
    dlg.querySelector('h2').textContent = opts.title || 'Are you sure?';
    dlg.querySelector('p').textContent = opts.message || '';
    dlg.querySelector('[data-v="1"]').textContent = opts.action || 'Confirm';
    document.body.appendChild(dlg);
    let result = false;
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (b) { result = b.dataset.v === '1'; dlg.close(); }
    });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    if (dlg.showModal) dlg.showModal(); else resolve(window.confirm(opts.message));
  });
}

/**
 * Calls fetcher() every `everyMs` and hands the result to onData. Pauses while the
 * tab is hidden, backs off after errors, and reports its state through onStatus
 * ({ state: 'ok'|'stale'|'error', text }) for the "Live" indicator in the top bar.
 */
export function poll(fetcher, everyMs, onData, onStatus = () => {}) {
  let timer = null, fails = 0, stopped = false, running = false;
  const schedule = () => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(run, fails ? Math.min(everyMs * (fails + 1), 120000) : everyMs);
  };
  async function run() {
    if (stopped) return;
    if (document.hidden || running) { schedule(); return; }
    running = true;
    try {
      const data = await fetcher();
      if (stopped) return;
      fails = 0;
      onData(data);
      const t = new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
      onStatus({ state: 'ok', text: `Updated ${t}` });
    } catch (err) {
      fails++;
      onStatus(fails > 2 ? { state: 'error', text: 'Connection lost — retrying' } : { state: 'stale', text: 'Retrying…' });
      if (fails === 3) toast(`Live updates paused: ${err.message}`, 'error');
      if (fails === 1) console.error(err);
    } finally {
      running = false;
      schedule();
    }
  }
  const onVisible = () => { if (!document.hidden) { clearTimeout(timer); run(); } };
  document.addEventListener('visibilitychange', onVisible);
  run();
  return {
    refresh() { clearTimeout(timer); run(); },
    stop() { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); },
  };
}

/** Shared Chart.js look. */
export function chartDefaults(Chart) {
  const css = getComputedStyle(document.body);
  Chart.defaults.font.family = css.getPropertyValue('--font').trim() || 'system-ui';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = css.getPropertyValue('--ink-3').trim();
  Chart.defaults.borderColor = css.getPropertyValue('--line').trim();
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.plugins.legend.labels.boxHeight = 8;
  Chart.defaults.plugins.tooltip.backgroundColor = css.getPropertyValue('--ink').trim();
  Chart.defaults.plugins.tooltip.titleColor = css.getPropertyValue('--surface').trim();
  Chart.defaults.plugins.tooltip.bodyColor = css.getPropertyValue('--surface').trim();
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.datasets.bar.maxBarThickness = 40;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.responsive = true;
}

/** Downloads rows as a CSV file (opens fine in Excel). */
export function downloadCsv(filename, rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
