/* FNIX Ёлки — отчёт по продажам */
(() => {
'use strict';
const CFG = window.CONFIG || {};
const COMM = CFG.KASPI_COMMISSION ?? 0.12;
const TAX = CFG.TAX_RATE ?? 0.03;
const TAXL = 'Налог ' + +(TAX * 100).toFixed(2) + '%';
const SHEETS = { dds: 'ДДС', cost: 'Себестоимость', map: 'Сопоставление', kaspi: 'Kaspi', stores: 'Магазины', leads: 'Лиды', opt: 'Опт', trucks: 'Фуры' };
const NUMS = ['amount', 'cost', 'sum', 'qty', 'logistics', 'goodsSum', 'driver', 'customs', 'border'];
const LS = { state: 'fnix_state', outbox: 'fnix_outbox', pin: 'fnix_pin', period: 'fnix_period' };
const CHANNELS = ['Kaspi', 'Опт', 'WB', 'Общее'];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
const fmt = n => Math.round(n).toLocaleString('ru-RU') + ' ₸';
const fmtN = n => Math.round(n).toLocaleString('ru-RU');
const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '—';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const hash = s => { let h = 5381; for (const c of String(s)) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const nowIso = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 19); };
const ruDate = d => d ? d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) : '';
const isFnix = name => /FNIX/i.test(name || '');
const isTree = r => r.trees === true || /^(да|true|1)$/i.test(String(r.trees ?? '').trim());
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };

/* ================= Хранилище ================= */
let S = { dds: [], cost: [], map: [], kaspi: [], stores: [], leads: [], opt: [], trucks: [] };
let outbox = lsGet(LS.outbox, []);
let pin = lsGet(LS.pin, '');
const remote = !!CFG.API_URL;
let role = lsGet('fnix_role', 'owner');
const RO = () => remote && role === 'manager';
const MANAGER_KEYS = ['leads', 'opt'];
const canEdit = key => !RO() || MANAGER_KEYS.includes(key);
const whoAmI = () => RO() ? 'Менеджер' : 'Владелец';
let flushing = false;

function normalize(key, rows) {
  return (rows || []).map(r => {
    const o = { ...r };
    o.id = String(o.id);
    NUMS.forEach(k => { if (k in o) o[k] = num(o[k]); });
    if (o.date) o.date = String(o.date).slice(0, 10);
    if (key === 'kaspi' && o.order !== undefined) o.order = String(o.order);
    if (key === 'leads') { o.phone = String(o.phone ?? ''); if (o.next) o.next = String(o.next).slice(0, 10); }
    return o;
  });
}
function persist() { lsSet(LS.state, S); lsSet(LS.outbox, outbox); }

function setSync(cls, text) {
  const el = $('#sync'); el.className = 'sync ' + cls; $('#syncText').textContent = text;
}
function syncStatus() {
  if (!remote) return setSync('bad', 'Локальный режим');
  if (outbox.length) return setSync(flushing ? 'busy' : 'bad', flushing ? 'Сохраняю в Google…' : `Нет связи · в очереди ${outbox.length}`);
  setSync('ok', 'Сохранено в Google');
}

async function api(body) {
  const res = await fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify({ ...body, pin }), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'error');
  return j;
}
async function flush() {
  if (!remote || flushing || !outbox.length) return syncStatus();
  flushing = true; syncStatus();
  try {
    let i = 0, failed = 0;
    while (i < outbox.length) {
      try { await api(outbox[i]); outbox.splice(i, 1); persist(); syncStatus(); }
      catch (e) {
        if (e instanceof TypeError) throw e;          // нет сети — пробуем позже
        if (String(e.message) === 'pin') throw e;
        i++; failed++;                                // ошибка на сервере — не блокируем остальные
      }
    }
    if (failed) setTimeout(flush, 60000);
  } catch (e) {
    if (String(e.message) === 'pin') { lsSet(LS.pin, ''); showLogin('ПИН изменился, войдите заново'); }
    setTimeout(flush, 15000);
  } finally { flushing = false; syncStatus(); }
}
function queue(op) { outbox.push(op); persist(); flush(); }

function put(key, rows, silent) {
  if (!canEdit(key)) { toast('Менеджер может менять только вкладку «Опт · лиды»'); return; }
  const idx = new Map(S[key].map((r, i) => [r.id, i]));
  rows.forEach(r => { if (idx.has(r.id)) S[key][idx.get(r.id)] = r; else { idx.set(r.id, S[key].length); S[key].push(r); } });
  for (let i = 0; i < rows.length; i += 800) queue({ action: 'upsert', sheet: SHEETS[key], rows: rows.slice(i, i + 800) });
  persist(); if (!silent) render();
}
function del(key, ids) {
  if (!canEdit(key)) { toast('Менеджер может менять только вкладку «Опт · лиды»'); return; }
  const set = new Set(ids);
  if (key === 'dds') S.dds.forEach(r => { if (set.has(r.id)) r.deleted = nowIso(); });
  else S[key] = S[key].filter(r => !set.has(r.id));
  for (let i = 0; i < ids.length; i += 2000) queue({ action: 'delete', sheet: SHEETS[key], ids: ids.slice(i, i + 2000) });
  persist(); render();
}

async function loadRemote() {
  setSync('busy', 'Загрузка…');
  await flush();
  const res = await fetch(CFG.API_URL + '?pin=' + encodeURIComponent(pin));
  const j = await res.json();
  if (!j.ok) { if (j.error === 'pin') { lsSet(LS.pin, ''); showLogin('Неверный ПИН'); return false; } throw new Error(j.error); }
  role = j.role || 'owner'; lsSet('fnix_role', role); applyRole();
  Object.entries(SHEETS).forEach(([k, name]) => { S[k] = normalize(k, j.data[name]); });
  const keyOf = Object.fromEntries(Object.entries(SHEETS).map(([k, n]) => [n, k]));
  outbox.forEach(op => {   // не потерять то, что ещё не дошло до Google
    const k = keyOf[op.sheet]; if (!k) return;
    if (op.action === 'upsert') { const idx = new Map(S[k].map((r, i) => [r.id, i])); normalize(k, op.rows).forEach(r => idx.has(r.id) ? S[k][idx.get(r.id)] = r : S[k].push(r)); }
    else if (op.action === 'delete') { const set = new Set(op.ids); if (k === 'dds') S.dds.forEach(r => { if (set.has(r.id)) r.deleted = r.deleted || nowIso(); }); else S[k] = S[k].filter(r => !set.has(r.id)); }
  });
  persist(); syncStatus(); render();
  return true;
}

/* ================= Утилиты ================= */
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
function segVal(el) { return $('button.on', el)?.dataset.v; }
function setSeg(el, v) { $$('button', el).forEach(b => b.classList.toggle('on', b.dataset.v === v)); }
$$('.seg').forEach(el => el.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  setSeg(el, b.dataset.v); if (!el.classList.contains('seg-input')) render();
}));

// периоды
const periods = lsGet(LS.period, {});
function monthRange(off) { const d = new Date(); const a = new Date(d.getFullYear(), d.getMonth() + off, 1); const b = new Date(d.getFullYear(), d.getMonth() + off + 1, 0);
  const f = x => new Date(x - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); return { from: f(a), to: f(b) }; }
$$('.period').forEach(el => {
  const k = el.dataset.period; periods[k] = periods[k] || { from: '', to: '' };
  el.innerHTML = `<input type="date" data-f="from"><span style="color:var(--muted)">—</span><input type="date" data-f="to">
    <button class="btn ghost sm" data-p="0">Этот месяц</button><button class="btn ghost sm" data-p="-1">Прошлый</button><button class="btn ghost sm" data-p="all">Всё время</button>`;
  const sync = () => { $('[data-f=from]', el).value = periods[k].from; $('[data-f=to]', el).value = periods[k].to; };
  sync();
  el.addEventListener('change', e => { periods[k][e.target.dataset.f] = e.target.value; lsSet(LS.period, periods); render(); });
  el.addEventListener('click', e => { const p = e.target.dataset.p; if (p === undefined) return;
    periods[k] = p === 'all' ? { from: '', to: '' } : monthRange(+p); sync(); lsSet(LS.period, periods); render(); });
});
const inP = (d, k) => { const p = periods[k]; return (!p.from || d >= p.from) && (!p.to || d <= p.to); };

/* ================= Справочники ================= */
function mapIndex() { const m = new Map(); S.map.forEach(r => { if (r.name) m.set(r.kaspi, r.name); }); return m; }
function costIndex() { const m = new Map(); S.cost.forEach(r => m.set(String(r.name).trim().toLowerCase(), num(r.cost))); return m; }
function costOf(ci, name) { return name ? ci.get(String(name).trim().toLowerCase()) : undefined; }

function kaspiCalc(periodKey, seg, store = 'all') {
  const mi = mapIndex(), ci = costIndex();
  const out = { rev: 0, comm: 0, log: 0, cogs: 0, tax: 0, qty: 0, orders: 0, cancel: 0, ret: 0, noCost: 0, rows: [] };
  S.kaspi.forEach(r => {
    if (!inP(r.date, periodKey)) return;
    if (store !== 'all' && (r.store || '') !== store) return;
    const fn = isFnix(r.kaspi);
    if (seg === 'fnix' && !fn) return;
    if (seg === 'other' && fn) return;
    if (r.status === 'Отменен') { out.cancel++; return; }
    if (r.status === 'Возврат') { out.ret++; return; }
    if (r.status !== 'Выдан') return;
    const name = mi.get(r.kaspi);
    const unit = costOf(ci, name);
    const x = { ...r, fnix: fn, name, unit, comm: r.sum * COMM, tax: r.sum * TAX, cogs: (unit || 0) * r.qty };
    x.profit = r.sum - x.comm - r.logistics - x.cogs - x.tax;
    if (unit === undefined) out.noCost += r.qty;
    out.rev += r.sum; out.comm += x.comm; out.log += r.logistics; out.cogs += x.cogs; out.tax += x.tax; out.qty += r.qty; out.orders++;
    out.rows.push(x);
  });
  out.profit = out.rev - out.comm - out.log - out.cogs - out.tax;
  return out;
}
function optCalc(periodKey) {
  const ci = costIndex();
  const rows = S.opt.filter(r => inP(r.date, periodKey)).map(r => { const unit = costOf(ci, r.model); return { ...r, unit, cogs: (unit || 0) * r.qty, tax: r.sum * TAX, profit: r.sum - (unit || 0) * r.qty - r.sum * TAX }; });
  return { rows, rev: sum(rows, 'sum'), cogs: sum(rows, 'cogs'), tax: sum(rows, 'tax'), qty: sum(rows, 'qty'), profit: sum(rows, 'profit'), noCost: rows.filter(r => r.unit === undefined).length };
}
const sum = (a, k) => a.reduce((s, r) => s + num(typeof k === 'function' ? k(r) : r[k]), 0);
const kpi = (l, v, s = '', cls = '') => `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
const sign = n => `<span class="${n < 0 ? 'neg' : 'pos'}">${fmt(n)}</span>`;

/* ================= Графики ================= */
const charts = {};
function chart(id, cfg) {
  if (typeof Chart === 'undefined') return;
  if (charts[id]) charts[id].destroy();
  Chart.defaults.color = '#9fb3c4'; Chart.defaults.font.family = 'Manrope';
  Chart.defaults.borderColor = 'rgba(255,255,255,.06)';
  charts[id] = new Chart(document.getElementById(id), cfg);
}
const chartOpts = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
  plugins: { legend: { labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.raw)}` } } },
  scales: { y: { ticks: { callback: v => (v / 1000).toLocaleString('ru-RU') + 'k' } }, x: { grid: { display: false } } } };

/* ================= Kaspi ================= */
let lastHints = {};
$('#kaspiFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    const h = aoa[0].map(x => String(x).trim());
    const col = n => h.indexOf(n);
    const c = { order: col('№ заказа'), date: col('Дата поступления заказа'), kaspi: col('Название товара в Kaspi Магазине'),
      seller: col('Название в системе продавца'), sku: col('Артикул'), sum: col('Сумма'), cat: col('Категория'), city: col('Адрес самовывоза/доставки'),
      status: col('Статус'), qty: col('Количество'), log: col('Стоимость доставки для продавца'), wh: col('Склад передачи КД') };
    if (c.log < 0) c.log = 23; // столбец X
    if (c.order < 0 || c.kaspi < 0 || c.sum < 0) throw new Error('Не похоже на архив заказов Kaspi');
    const store = pickStore(aoa.slice(1), c.wh, f.name);
    if (!store) return;
    const rows = [];
    let skipped = 0;
    // только ёлки: по категории Kaspi, а если её нет — по названию товара
    const treeRe = /(^|[^а-яё])[её]л(к|оч)/i;
    const isTreeRow = r => c.cat >= 0 && String(r[c.cat]).trim()
      ? String(r[c.cat]).trim().toLowerCase().replace(/ё/g, 'е') === String(CFG.TREE_CATEGORY || 'Новогодние елки').toLowerCase().replace(/ё/g, 'е')
      : treeRe.test(String(r[c.kaspi]));
    aoa.slice(1).forEach(r => {
      if (!r[c.order]) return;
      if (!isTreeRow(r)) { skipped++; return; }
      const d = String(r[c.date]).trim(); const m = d.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
      const kaspi = String(r[c.kaspi]).trim();
      if (c.seller >= 0 && r[c.seller]) lastHints[kaspi] = String(r[c.seller]).trim();
      rows.push({ id: String(r[c.order]) + '_' + String(r[c.sku] || ''), order: String(r[c.order]), date: m ? `${m[3]}-${m[2]}-${m[1]}` : d.slice(0, 10),
        kaspi, sku: String(r[c.sku] || ''), sum: num(r[c.sum]), qty: num(r[c.qty]) || 1, status: String(r[c.status]).trim(),
        logistics: num(r[c.log]), city: String(r[c.city] || '').replace(/^г\.\s*/, ''), store: store.id });
    });
    if (!rows.length) throw new Error('В файле нет заказов категории «' + CFG.TREE_CATEGORY + '»');
    put('kaspi', rows);
    toast(`${store.name}: загружено заказов ёлок ${rows.length}` + (skipped ? ` · других товаров убрано ${skipped}` : ''));
  } catch (err) { toast('Ошибка: ' + err.message); }
});

// Магазин определяется по ID продавца в столбце «Склад передачи КД» (например 30383279_PP2)
function pickStore(rows, whCol, fileName) {
  let mid = '';
  if (whCol >= 0) {
    const cnt = {};
    rows.forEach(r => { const m = String(r[whCol] || '').match(/^(\d{5,})_/); if (m) cnt[m[1]] = (cnt[m[1]] || 0) + 1; });
    mid = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || '';
  }
  let st = mid && S.stores.find(x => String(x.mid) === mid);
  if (st) return st;
  const known = S.stores.map(x => x.name).join(', ');
  const name = (prompt(`Новый Kaspi магазин${mid ? ' (ID ' + mid + ')' : ''}.\nКак его назвать?` + (known ? `\n\nУже есть: ${known}\nЕсли это один из них — впишите точно так же.` : ''), '') || '').trim();
  if (!name) { toast('Загрузка отменена: не указан магазин'); return null; }
  st = S.stores.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (st) { if (mid && !st.mid) put('stores', [{ ...st, mid }], true); return st; }
  st = { id: 's_' + (mid || hash(name)), mid, name };
  put('stores', [st], true);
  return st;
}
const storeName = id => (S.stores.find(x => x.id === id) || {}).name || 'Магазин не указан';
function fillStoreSelect(sel) {
  const v = sel.value || 'all';
  const ids = [...new Set(S.kaspi.map(r => r.store || ''))];
  const opts = [['all', 'Все магазины'], ...S.stores.filter(x => ids.includes(x.id)).map(x => [x.id, x.name])];
  if (ids.includes('')) opts.push(['', 'Магазин не указан']);
  sel.innerHTML = opts.map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join('');
  sel.value = opts.some(o => o[0] === v) ? v : 'all';
  sel.classList.toggle('hidden', opts.length <= 2 && !ids.includes(''));
  return sel.value;
}
$('#kaspiStore').addEventListener('change', render);
$('#pnlStore').addEventListener('change', render);
$('#kaspiStores').addEventListener('click', e => {
  const b = e.target.closest('[data-rename]'); if (!b) return;
  const st = S.stores.find(x => x.id === b.dataset.rename); if (!st) return;
  const name = (prompt('Новое название магазина', st.name) || '').trim();
  if (name && name !== st.name) put('stores', [{ ...st, name }]);
});

function unmappedNames() {
  const mi = mapIndex();
  return [...new Set(S.kaspi.map(r => r.kaspi))].filter(n => !mi.has(n));
}
$('#tplBtn').addEventListener('click', downloadTemplate);
function downloadTemplate() {
  const mi = mapIndex();
  const names = [...new Set(S.kaspi.map(r => r.kaspi))].sort((a, b) => (mi.has(a) - mi.has(b)) || a.localeCompare(b, 'ru'));
  if (!names.length) return toast('Сначала загрузите архив Kaspi');
  const aoa = [['Название в Kaspi', 'Тип карточки', 'Подсказка: название в системе продавца', 'Наше наименование (заполнить)']];
  names.forEach(n => aoa.push([n, isFnix(n) ? 'FNIX (закрытая)' : 'Общая', lastHints[n] || '', mi.get(n) || '']));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 60 }, { wch: 16 }, { wch: 50 }, { wch: 40 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Сопоставление');
  XLSX.writeFile(wb, 'Шаблон сопоставления Kaspi.xlsx');
}
$('#tplFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    const h = aoa[0].map(x => String(x).trim());
    const ck = h.indexOf('Название в Kaspi'), cn = h.findIndex(x => x.startsWith('Наше наименование'));
    if (ck < 0 || cn < 0) throw new Error('Нужны столбцы «Название в Kaspi» и «Наше наименование»');
    const rows = aoa.slice(1).filter(r => String(r[ck]).trim() && String(r[cn]).trim()).map(r => {
      const k = String(r[ck]).trim();
      return { id: 'm_' + hash(k), kaspi: k, name: String(r[cn]).trim(), type: isFnix(k) ? 'FNIX' : 'Общая' };
    });
    if (!rows.length) throw new Error('Не заполнено ни одного наименования');
    put('map', rows);
    toast(`Сопоставлено карточек: ${rows.length}`);
  } catch (err) { toast('Ошибка: ' + err.message); }
});
$('#kaspiClear').addEventListener('click', () => {
  const st = $('#kaspiStore').value;
  const rows = st === 'all' ? S.kaspi : S.kaspi.filter(r => (r.store || '') === st);
  if (!rows.length) return;
  const what = st === 'all' ? 'весь архив Kaspi всех магазинов' : `архив магазина «${storeName(st)}»`;
  if (!confirm(`Удалить ${what} (${rows.length} строк)? ДДС, себестоимость и сопоставления останутся.`)) return;
  del('kaspi', rows.map(r => r.id)); toast('Архив очищен');
});
$('#mapAlert').addEventListener('click', e => { if (e.target.closest('[data-tpl]')) downloadTemplate(); });

function renderKaspi() {
  const seg = segVal($('#kaspiSeg'));
  const st = fillStoreSelect($('#kaspiStore'));
  const k = kaspiCalc('kaspi', seg, st);
  const um = unmappedNames();
  const al = $('#mapAlert');
  if (um.length) { al.classList.remove('hidden'); al.innerHTML = `<span>⚠️ ${um.length} карточек Kaspi без нашего наименования — их себестоимость не посчитается.</span><button class="btn gold sm" data-tpl>Скачать шаблон</button>`; }
  else al.classList.add('hidden');

  $('#kaspiKpis').innerHTML =
    kpi('Выручка', fmt(k.rev), `${fmtN(k.qty)} шт · ${fmtN(k.orders)} заказов`) +
    kpi('Kaspi 12%', fmt(k.comm)) +
    kpi('Логистика', fmt(k.log)) +
    kpi('Себестоимость', fmt(k.cogs), k.noCost ? `<span class="neg">без себестоимости: ${fmtN(k.noCost)} шт</span>` : '') +
    kpi(TAXL, fmt(k.tax), 'упрощёнка, с выручки') +
    kpi('Прибыль', sign(k.profit), 'маржа ' + pct(k.profit, k.rev), 'hl') +
    kpi('Отмены / возвраты', `${fmtN(k.cancel)} / ${fmtN(k.ret)}`);

  // по дням
  const days = {};
  k.rows.forEach(r => { const d = days[r.date] ||= { rev: 0, profit: 0 }; d.rev += r.sum; d.profit += r.profit; });
  const dk = Object.keys(days).sort();
  chart('kaspiChart', { type: 'bar', data: { labels: dk.map(d => d.slice(8, 10) + '.' + d.slice(5, 7)), datasets: [
    { label: 'Выручка', data: dk.map(d => days[d].rev), backgroundColor: 'rgba(232,194,107,.55)', borderRadius: 4, order: 2 },
    { label: 'Прибыль', data: dk.map(d => days[d].profit), type: 'line', borderColor: '#4cc28a', backgroundColor: '#4cc28a', pointRadius: 0, tension: .3, order: 1 }] }, options: chartOpts });

  const f = kaspiCalc('kaspi', 'fnix', st), o = kaspiCalc('kaspi', 'other', st);
  $('#kaspiSplit').innerHTML = `<div class="split">
    <div></div><div class="h n"><span class="tag fnix">FNIX</span></div><div class="h n"><span class="tag">Общие</span></div>
    <div class="h">Выручка</div><div class="n">${fmt(f.rev)}</div><div class="n">${fmt(o.rev)}</div>
    <div class="h">Продано, шт</div><div class="n">${fmtN(f.qty)}</div><div class="n">${fmtN(o.qty)}</div>
    <div class="h">Kaspi + логистика</div><div class="n">${fmt(f.comm + f.log)}</div><div class="n">${fmt(o.comm + o.log)}</div>
    <div class="h">Себестоимость</div><div class="n">${fmt(f.cogs)}</div><div class="n">${fmt(o.cogs)}</div>
    <div class="h">${TAXL}</div><div class="n">${fmt(f.tax)}</div><div class="n">${fmt(o.tax)}</div>
    <div class="h">Прибыль</div><div class="n">${sign(f.profit)}</div><div class="n">${sign(o.profit)}</div>
    <div class="h">Маржа</div><div class="n">${pct(f.profit, f.rev)}</div><div class="n">${pct(o.profit, o.rev)}</div>
    <div class="h">Доля выручки</div><div class="n">${pct(f.rev, f.rev + o.rev)}</div><div class="n">${pct(o.rev, f.rev + o.rev)}</div></div>`;

  // по магазинам
  const sids = [...new Set(S.kaspi.map(r => r.store || ''))];
  const card = $('#kaspiStoresCard');
  card.classList.toggle('hidden', sids.length < 2);
  const per = sids.map(id => ({ id, ...kaspiCalc('kaspi', seg, id) })).sort((a, b) => b.rev - a.rev);
  const tr = per.reduce((s, x) => s + x.rev, 0);
  $('#kaspiStores').innerHTML = `<thead><tr><th>Магазин</th><th class="n">Шт</th><th class="n">Выручка</th><th class="n">Доля</th><th class="n">Kaspi + логистика</th><th class="n">Себестоимость</th><th class="n">${TAXL}</th><th class="n">Прибыль</th><th class="n">Маржа</th><th></th></tr></thead><tbody>` +
    per.map(x => `<tr><td>${esc(storeName(x.id))}</td><td class="n">${fmtN(x.qty)}</td><td class="n">${fmt(x.rev)}</td><td class="n">${pct(x.rev, tr)}</td>
      <td class="n">${fmt(x.comm + x.log)}</td><td class="n">${fmt(x.cogs)}</td><td class="n">${fmt(x.tax)}</td><td class="n">${sign(x.profit)}</td><td class="n">${pct(x.profit, x.rev)}</td>
      <td class="n">${x.id ? `<button class="icon-btn" data-rename="${esc(x.id)}" title="Переименовать">✎</button>` : ''}</td></tr>`).join('') + '</tbody>';

  // по товарам
  const g = {};
  k.rows.forEach(r => {
    const key = r.name || r.kaspi;
    const x = g[key] ||= { name: key, mapped: !!r.name, fnix: r.fnix, unit: r.unit, qty: 0, rev: 0, comm: 0, log: 0, cogs: 0, tax: 0, profit: 0 };
    x.qty += r.qty; x.rev += r.sum; x.comm += r.comm; x.log += r.logistics; x.cogs += r.cogs; x.tax += r.tax; x.profit += r.profit;
  });
  const list = Object.values(g).sort((a, b) => b.rev - a.rev);
  $('#kaspiTable').innerHTML = list.length ? `<thead><tr><th>Наименование</th><th>Тип</th><th class="n">Шт</th><th class="n">Выручка</th><th class="n">Kaspi 12%</th><th class="n">Логистика</th><th class="n">Себест. ед.</th><th class="n">Себестоимость</th><th class="n">${TAXL}</th><th class="n">Прибыль</th><th class="n">Маржа</th></tr></thead><tbody>` +
    list.map(x => `<tr><td>${esc(x.name)} ${x.mapped ? '' : '<span class="tag warn">нет сопоставления</span>'}</td>
      <td><span class="tag ${x.fnix ? 'fnix' : ''}">${x.fnix ? 'FNIX' : 'Общая'}</span></td>
      <td class="n">${fmtN(x.qty)}</td><td class="n">${fmt(x.rev)}</td><td class="n">${fmt(x.comm)}</td><td class="n">${fmt(x.log)}</td>
      <td class="n">${x.unit === undefined ? '<span class="tag warn">нет</span>' : fmt(x.unit)}</td><td class="n">${fmt(x.cogs)}</td><td class="n">${fmt(x.tax)}</td>
      <td class="n">${sign(x.profit)}</td><td class="n">${pct(x.profit, x.rev)}</td></tr>`).join('') + '</tbody>'
    : `<tr><td class="empty">Загрузите архив заказов Kaspi (.xlsx)</td></tr>`;
}

/* ================= Себестоимость ================= */
function costNames() {
  const ci = new Map(S.cost.map(r => [String(r.name).trim().toLowerCase(), r]));
  const names = new Map();
  S.cost.forEach(r => names.set(String(r.name).trim().toLowerCase(), { name: r.name, row: r }));
  S.map.forEach(r => { if (r.name) { const k = r.name.trim().toLowerCase(); if (!names.has(k)) names.set(k, { name: r.name, row: ci.get(k) }); } });
  S.opt.forEach(r => { if (r.model) { const k = r.model.trim().toLowerCase(); if (!names.has(k)) names.set(k, { name: r.model, row: ci.get(k) }); } });
  return [...names.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
}
function renderCost() {
  const mi = mapIndex();
  const usage = {};
  S.kaspi.forEach(r => { if (r.status === 'Выдан') { const n = (mi.get(r.kaspi) || '').toLowerCase(); if (n) usage[n] = (usage[n] || 0) + r.qty; } });
  const list = costNames();
  $('#costTable').innerHTML = list.length ? `<thead><tr><th>Наименование</th><th class="n">Себестоимость, ₸</th><th class="n">Продано на Kaspi, шт</th><th></th></tr></thead><tbody>` +
    list.map(x => `<tr><td>${esc(x.name)} ${x.row ? '' : '<span class="tag warn">не указана</span>'}</td>
      <td class="n"><input class="cost-input" ${RO() ? 'disabled' : ''} type="number" step="any" data-name="${esc(x.name)}" value="${x.row ? x.row.cost : ''}" placeholder="0"></td>
      <td class="n">${fmtN(usage[String(x.name).trim().toLowerCase()] || 0)}</td>
      <td class="n">${x.row ? `<button class="icon-btn owner-only" title="Удалить цену" data-del-cost="${esc(x.row.id)}">🗑</button>` : ''}</td></tr>`).join('') + '</tbody>'
    : `<tr><td class="empty">Наименования появятся после сопоставления карточек Kaspi или добавьте вручную</td></tr>`;
}
$('#costTable').addEventListener('change', e => {
  const i = e.target.closest('.cost-input'); if (!i || i.value === '') return;
  const name = i.dataset.name, k = name.trim().toLowerCase();
  const ex = S.cost.find(r => String(r.name).trim().toLowerCase() === k);
  put('cost', [{ id: ex ? ex.id : 'c_' + hash(k), name, cost: num(i.value), updated: nowIso() }], true);
  i.closest('tr').querySelector('.tag.warn')?.remove();
  toast('Себестоимость сохранена');
});
$('#costTable').addEventListener('click', e => {
  const b = e.target.closest('[data-del-cost]'); if (!b) return;
  if (confirm('Удалить себестоимость этого товара?')) del('cost', [b.dataset.delCost]);
});
$('#costAdd').addEventListener('submit', e => {
  e.preventDefault(); const f = e.target; const name = f.name.value.trim(); if (!name) return;
  const k = name.toLowerCase(); const ex = S.cost.find(r => String(r.name).trim().toLowerCase() === k);
  put('cost', [{ id: ex ? ex.id : 'c_' + hash(k), name, cost: num(f.cost.value), updated: nowIso() }]);
  f.reset(); toast('Добавлено');
});

/* ================= ДДС ================= */
const ddsForm = $('#ddsForm');
function ddsReset() {
  ddsForm.reset(); delete ddsForm.dataset.id; ddsForm.date.value = today();
  $('#ddsFormTitle').textContent = 'Новый расход'; $('#ddsCancel').classList.add('hidden');
}
ddsReset();
$('#ddsCancel').addEventListener('click', ddsReset);
ddsForm.addEventListener('submit', e => {
  e.preventDefault();
  const id = ddsForm.dataset.id;
  const prev = id ? S.dds.find(r => r.id === id) : null;
  const row = { id: id || uid(), date: ddsForm.date.value, channel: segVal($('[data-name=channel]', ddsForm)), kind: segVal($('[data-name=kind]', ddsForm)),
    item: ddsForm.item.value.trim(), counterparty: ddsForm.counterparty.value.trim(), payment: ddsForm.payment.value.trim(),
    amount: num(ddsForm.amount.value), purpose: ddsForm.purpose.value.trim(), trees: ddsForm.trees.checked ? 'да' : '', created: prev ? prev.created : nowIso(), updated: nowIso(), deleted: prev ? prev.deleted : '' };
  put('dds', [row]); toast(id ? 'Расход изменён' : 'Расход сохранён');
  const keep = { channel: row.channel, kind: row.kind, date: row.date };
  ddsReset(); ddsForm.date.value = keep.date;
  setSeg($('[data-name=channel]', ddsForm), keep.channel); setSeg($('[data-name=kind]', ddsForm), keep.kind);
  ddsForm.item.focus();
});
// автозаполнение: по знакомой статье подставляем вид, контрагента и способ оплаты
ddsForm.item.addEventListener('change', () => {
  if (ddsForm.dataset.id) return;
  const v = ddsForm.item.value.trim().toLowerCase();
  const last = [...S.dds].reverse().find(r => !r.deleted && String(r.item).toLowerCase() === v);
  if (!last) return;
  setSeg($('[data-name=kind]', ddsForm), last.kind);
  if (!ddsForm.counterparty.value) ddsForm.counterparty.value = last.counterparty || '';
  if (!ddsForm.payment.value) ddsForm.payment.value = last.payment || '';
});
function fillDatalists() {
  const freq = (rows, k, extra = []) => {
    const c = {}; extra.forEach(x => c[x] = 0);
    rows.forEach(r => { const v = String(r[k] || '').trim(); if (v) c[v] = (c[v] || 0) + 1; });
    return Object.keys(c).sort((a, b) => c[b] - c[a]);
  };
  const live = S.dds.filter(r => !r.deleted);
  const set = (id, list) => { $('#' + id).innerHTML = list.map(v => `<option value="${esc(v)}">`).join(''); };
  set('dl-item', freq(live, 'item')); set('dl-counterparty', freq(live, 'counterparty'));
  set('dl-payment', freq(live, 'payment', ['Kaspi Bank', 'Halyk Bank', 'Наличные']));
  set('dl-purpose', freq(live, 'purpose'));
  set('dl-buyer', freq(S.opt, 'buyer'));
  set('dl-model', costNames().map(x => x.name));
  set('dl-city', freq(S.leads, 'city')); set('dl-source', freq(S.leads, 'source'));
}
$('#ddsSearch').addEventListener('input', () => renderDds());
$('#ddsTable').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const r = S.dds.find(x => x.id === b.dataset.id); if (!r) return;
  if (b.dataset.act === 'edit') {
    ddsForm.dataset.id = r.id; ddsForm.date.value = r.date; setSeg($('[data-name=channel]', ddsForm), r.channel); setSeg($('[data-name=kind]', ddsForm), r.kind);
    ddsForm.item.value = r.item; ddsForm.counterparty.value = r.counterparty; ddsForm.payment.value = r.payment; ddsForm.amount.value = r.amount; ddsForm.purpose.value = r.purpose; ddsForm.trees.checked = isTree(r);
    $('#ddsFormTitle').textContent = 'Правка расхода'; $('#ddsCancel').classList.remove('hidden'); ddsForm.scrollIntoView({ behavior: 'smooth' });
  } else if (b.dataset.act === 'del') {
    if (confirm(`Удалить расход «${r.item}» на ${fmt(r.amount)}? Он останется в «Удалённых» и в Google Таблице.`)) { del('dds', [r.id]); toast('Перемещено в удалённые'); }
  } else if (b.dataset.act === 'restore') {
    put('dds', [{ ...r, deleted: '' }]); toast('Восстановлено');
  }
});
function ddsInPeriod(k) { return S.dds.filter(r => !r.deleted && inP(r.date, k)); }
function renderDds() {
  const ch = segVal($('#ddsChan')), q = $('#ddsSearch').value.trim().toLowerCase();
  const trash = ch === 'trash';
  let rows = S.dds.filter(r => (trash ? !!r.deleted : !r.deleted) && inP(r.date, 'dds'));
  if (!trash && ch !== 'all') rows = rows.filter(r => r.channel === ch);
  if (q) rows = rows.filter(r => [r.item, r.counterparty, r.payment, r.purpose, r.channel].join(' ').toLowerCase().includes(q));
  rows.sort((a, b) => b.date.localeCompare(a.date) || String(b.created).localeCompare(String(a.created)));
  const base = ddsInPeriod('dds');
  const byCh = c => sum(base.filter(r => r.channel === c), 'amount');
  $('#ddsKpis').innerHTML = kpi('Всего расходов', fmt(sum(base, 'amount')), `${base.length} записей`, 'hl') +
    CHANNELS.map(c => kpi(c, fmt(byCh(c)))).join('') +
    kpi('Постоянные', fmt(sum(base.filter(r => r.kind === 'Постоянный'), 'amount'))) +
    kpi('Переменные', fmt(sum(base.filter(r => r.kind !== 'Постоянный'), 'amount'))) +
    kpi('🎄 Связано с ёлками', fmt(sum(base.filter(isTree), 'amount')));
  $('#ddsTable').innerHTML = rows.length ? `<thead><tr><th>Дата</th><th>Канал</th><th>Вид</th><th>Статья</th><th>Контрагент</th><th>Оплата</th><th>Назначение</th><th class="n">Сумма</th><th></th></tr></thead><tbody>` +
    rows.map(r => `<tr class="${trash ? 'del' : ''}"><td>${ruDate(r.date)}</td><td><span class="tag">${esc(r.channel)}</span></td><td>${esc(r.kind)}</td>
      <td>${esc(r.item)}${isTree(r) ? '<span class="tag tree" title="Связано с ёлками">🎄</span>' : ''}</td><td>${esc(r.counterparty)}</td><td>${esc(r.payment)}</td><td>${esc(r.purpose)}</td><td class="n">${fmt(r.amount)}</td>
      <td class="n" style="text-decoration:none;opacity:1">${trash ? `<button class="icon-btn owner-only" data-act="restore" data-id="${esc(r.id)}" title="Восстановить">↺</button>`
        : `<button class="icon-btn owner-only" data-act="edit" data-id="${esc(r.id)}" title="Изменить">✎</button><button class="icon-btn owner-only" data-act="del" data-id="${esc(r.id)}" title="Удалить">🗑</button>`}</td></tr>`).join('') +
    `<tr><td colspan="7"><b>Итого</b></td><td class="n"><b>${fmt(sum(rows, 'amount'))}</b></td><td></td></tr></tbody>`
    : `<tr><td class="empty">${trash ? 'Удалённых записей нет' : 'Расходов за период нет'}</td></tr>`;
}

/* ================= ОПиУ ================= */
function pnlFor(periodKey, seg, store = 'all') {
  const k = kaspiCalc(periodKey, seg, store), o = optCalc(periodKey);
  let d = ddsInPeriod(periodKey);
  const tm = segVal($('#pnlTrees'));
  if (tm === 'no') d = d.filter(r => !isTree(r)); else if (tm === 'only') d = d.filter(isTree);
  const exp = (ch, kind) => sum(d.filter(r => r.channel === ch && (kind === 'Постоянный' ? r.kind === 'Постоянный' : r.kind !== 'Постоянный')), 'amount');
  const col = {
    Kaspi: { rev: k.rev, comm: k.comm, log: k.log, cogs: k.cogs },
    'Опт': { rev: o.rev, comm: 0, log: 0, cogs: o.cogs },
    WB: { rev: 0, comm: 0, log: 0, cogs: 0 },
    'Общее': { rev: 0, comm: 0, log: 0, cogs: 0 }
  };
  CHANNELS.forEach(c => { const x = col[c]; x.gross = x.rev - x.comm - x.log - x.cogs; x.vari = exp(c, 'Переменный'); x.fixed = exp(c, 'Постоянный');
    x.ebt = x.gross - x.vari - x.fixed; x.tax = x.rev * TAX; x.net = x.ebt - x.tax; });
  const tot = {}; ['rev', 'comm', 'log', 'cogs', 'gross', 'vari', 'fixed', 'ebt', 'tax', 'net'].forEach(f => tot[f] = CHANNELS.reduce((s, c) => s + col[c][f], 0));
  col['Итого'] = tot;
  return { col, k, o, d };
}
function renderPnl() {
  const seg = segVal($('#pnlSeg'));
  const st = fillStoreSelect($('#pnlStore'));
  const { col, k, d } = pnlFor('pnl', seg, st);
  const t = col['Итого'];
  $('#pnlKpis').innerHTML = kpi('Выручка', fmt(t.rev)) + kpi('Валовая прибыль', sign(t.gross), 'маржа ' + pct(t.gross, t.rev)) +
    kpi('Расходы ДДС', fmt(t.vari + t.fixed)) + kpi(TAXL, fmt(t.tax), 'упрощёнка, с выручки') + kpi('Чистая прибыль', sign(t.net), 'рентабельность ' + pct(t.net, t.rev), 'hl');
  const cols = [...CHANNELS, 'Итого'];
  const line = (label, f, cls = '', neg = false) => `<tr class="${cls}"><td>${label}</td>${cols.map(c => `<td class="n">${cls === 'sum' ? sign(col[c][f]) : (col[c][f] ? (neg ? '−' : '') + fmt(col[c][f]) : '—')}</td>`).join('')}</tr>`;
  const pline = (label, f) => `<tr class="sub"><td>${label}</td>${cols.map(c => `<td class="n">${pct(col[c][f], col[c].rev)}</td>`).join('')}</tr>`;
  $('#pnlTable').innerHTML = `<thead><tr><th>Статья</th>${cols.map(c => `<th class="n">${c}</th>`).join('')}</tr></thead><tbody>` +
    line('Выручка', 'rev') + line('Комиссия Kaspi 12%', 'comm', 'sub', true) + line('Логистика Kaspi', 'log', 'sub', true) + line('Себестоимость', 'cogs', 'sub', true) +
    line('Валовая прибыль', 'gross', 'sum') + pline('Валовая маржа', 'gross') +
    line('Переменные расходы', 'vari', 'sub', true) + line('Постоянные расходы', 'fixed', 'sub', true) +
    line('Прибыль до налога', 'ebt', 'sum') + line(TAXL + ' (упрощёнка, с выручки)', 'tax', 'sub', true) +
    line('Чистая прибыль', 'net', 'sum') + pline('Рентабельность', 'net') + '</tbody>';
  const warn = [];
  if (k.noCost) warn.push(`${fmtN(k.noCost)} шт на Kaspi без себестоимости`);
  // по месяцам
  const months = new Set();
  S.kaspi.forEach(r => inP(r.date, 'pnl') && months.add(r.date.slice(0, 7)));
  S.opt.forEach(r => inP(r.date, 'pnl') && months.add(r.date.slice(0, 7)));
  d.forEach(r => months.add(r.date.slice(0, 7)));
  const ms = [...months].sort();
  const saved = periods.pnl;
  const series = ms.map(m => {
    const [y, mo] = m.split('-').map(Number); const last = new Date(y, mo, 0).getDate();
    let from = m + '-01', to = m + '-' + String(last).padStart(2, '0');
    if (saved.from && saved.from > from) from = saved.from; if (saved.to && saved.to < to) to = saved.to;
    periods._m = { from, to }; const c = pnlFor('_m', seg, st).col['Итого']; return { m, rev: c.rev, net: c.net };
  });
  const mn = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  chart('pnlChart', { type: 'bar', data: { labels: series.map(s => mn[+s.m.slice(5) - 1] + ' ' + s.m.slice(2, 4)), datasets: [
    { label: 'Выручка', data: series.map(s => s.rev), backgroundColor: 'rgba(232,194,107,.55)', borderRadius: 4 },
    { label: 'Чистая прибыль', data: series.map(s => s.net), backgroundColor: series.map(s => s.net < 0 ? 'rgba(224,90,82,.7)' : 'rgba(76,194,138,.7)'), borderRadius: 4 }] }, options: chartOpts });
  const items = {}; d.forEach(r => items[r.item] = (items[r.item] || 0) + r.amount);
  const il = Object.entries(items).sort((a, b) => b[1] - a[1]); const max = il[0]?.[1] || 1;
  $('#pnlItems').innerHTML = (warn.length ? `<p class="hint neg">⚠️ ${warn.join(', ')}</p>` : '') + (il.length ? il.slice(0, 12).map(([n, v]) =>
    `<div class="bar-row"><span>${esc(n)}</span><span class="n">${fmt(v)}</span><div class="bar"><i style="width:${v / max * 100}%"></i></div></div>`).join('') : '<div class="empty">Расходов за период нет</div>');
}

/* ================= Опт ================= */
const optForm = $('#optForm');
function optReset() { optForm.reset(); delete optForm.dataset.id; delete optForm.dataset.lead; optForm.date.value = today(); $('#optFormTitle').textContent = 'Новая оптовая продажа'; $('#optCancel').classList.add('hidden'); }
optReset();
$('#optCancel').addEventListener('click', optReset);
optForm.addEventListener('submit', e => {
  e.preventDefault(); const id = optForm.dataset.id; const prev = id ? S.opt.find(r => r.id === id) : null;
  const saleId = id || uid(), leadId = optForm.dataset.lead || (prev && prev.lead) || '';
  put('opt', [{ id: saleId, date: optForm.date.value, buyer: optForm.buyer.value.trim(), model: optForm.model.value.trim(), qty: num(optForm.qty.value),
    sum: num(optForm.sum.value), note: optForm.note.value.trim(), lead: leadId, created: prev ? prev.created : nowIso() }]);
  if (leadId && !id) { const l = S.leads.find(x => x.id === leadId); if (l) put('leads', [{ ...l, stage: 'Сделка', sale: saleId, updated: nowIso(), by: whoAmI(),
    log: JSON.stringify([...leadLog(l), { ts: nowIso(), by: whoAmI(), text: `Сделка: ${optForm.model.value.trim()}, ${optForm.qty.value} шт, ${fmt(num(optForm.sum.value))}` }]) }], true); }
  toast(id ? 'Продажа изменена' : 'Продажа сохранена'); optReset();
});
$('#optTable').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return; const r = S.opt.find(x => x.id === b.dataset.id); if (!r) return;
  if (b.dataset.act === 'edit') {
    optForm.dataset.id = r.id; ['date', 'buyer', 'model', 'qty', 'sum', 'note'].forEach(k => optForm[k].value = r[k] ?? '');
    $('#optFormTitle').textContent = 'Правка продажи'; $('#optCancel').classList.remove('hidden'); optForm.scrollIntoView({ behavior: 'smooth' });
  } else if (confirm(`Удалить продажу ${r.buyer} — ${r.model}?`)) del('opt', [r.id]);
});
function renderOpt() {
  const view = segVal($('#optView'));
  $('#crmView').classList.toggle('hidden', view !== 'crm');
  $('#salesView').classList.toggle('hidden', view !== 'sales');
  if (view === 'crm') return renderCrm();
  const o = optCalc('opt');
  $('#optKpis').innerHTML = kpi('Выручка опт', fmt(o.rev), `${fmtN(o.qty)} шт`) + kpi('Себестоимость', fmt(o.cogs), o.noCost ? `<span class="neg">без себестоимости: ${o.noCost}</span>` : '') +
    kpi(TAXL, fmt(o.tax)) + kpi('Прибыль после налога', sign(o.profit), 'маржа ' + pct(o.profit, o.rev), 'hl') + kpi('Покупателей', fmtN(new Set(o.rows.map(r => r.buyer)).size));
  const rows = o.rows.sort((a, b) => b.date.localeCompare(a.date));
  $('#optTable').innerHTML = rows.length ? `<thead><tr><th>Дата</th><th>Покупатель</th><th>Модель</th><th class="n">Шт</th><th class="n">Сумма</th><th class="n">Себестоимость</th><th class="n">Прибыль</th><th>Примечание</th><th></th></tr></thead><tbody>` +
    rows.map(r => `<tr><td>${ruDate(r.date)}</td><td>${esc(r.buyer)}</td><td>${esc(r.model)}</td><td class="n">${fmtN(r.qty)}</td><td class="n">${fmt(r.sum)}</td>
      <td class="n">${r.unit === undefined ? '<span class="tag warn">нет</span>' : fmt(r.cogs)}</td><td class="n">${sign(r.profit)}</td><td>${esc(r.note)}</td>
      <td class="n"><button class="icon-btn" data-act="edit" data-id="${esc(r.id)}">✎</button><button class="icon-btn" data-act="del" data-id="${esc(r.id)}">🗑</button></td></tr>`).join('') + '</tbody>'
    : `<tr><td class="empty">Оптовых продаж за период нет</td></tr>`;
}

/* ================= CRM: лиды ================= */
const STAGES = ['Новый', 'Связались', 'Отправили прайс', 'Сделка', 'Отказ'];
const OPEN = ['Новый', 'Связались', 'Отправили прайс'];
const leadLog = l => { try { const a = Array.isArray(l.log) ? l.log : JSON.parse(l.log || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const phoneDigits = p => { let d = String(p || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1); if (d.length === 10) d = '7' + d; return d; };
const phoneFmt = p => { const d = phoneDigits(p); return d.length === 11 ? `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}` : (p || ''); };
const waLink = p => 'https://wa.me/' + phoneDigits(p);
const dueTag = l => { if (!l.next || !OPEN.includes(l.stage)) return ''; const t = today();
  return l.next < t ? `<span class="tag due">просрочено ${ruDate(l.next).slice(0, 5)}</span>` : l.next === t ? '<span class="tag today">сегодня</span>' : `<span class="tag">${ruDate(l.next).slice(0, 5)}</span>`; };

$('#optView').addEventListener('click', () => setTimeout(render));
$('#crmSearch').addEventListener('input', () => renderCrm());

const leadForm = $('#leadForm');
leadForm.addEventListener('submit', e => {
  e.preventDefault();
  const d = phoneDigits(leadForm.phone.value);
  if (d.length < 10) return toast('Проверьте номер телефона');
  const dup = S.leads.find(l => phoneDigits(l.phone) === d);
  if (dup) { toast('Этот номер уже есть — открыл карточку'); leadForm.phone.value = ''; openLead(dup.id); return; }
  const note = leadForm.note.value.trim();
  const l = { id: uid(), created: nowIso(), name: leadForm.name.value.trim(), phone: d, city: leadForm.city.value.trim(), source: leadForm.source.value.trim(),
    stage: 'Новый', next: today(), note, lost: '', sale: '', updated: nowIso(), by: whoAmI(),
    log: JSON.stringify(note ? [{ ts: nowIso(), by: whoAmI(), text: note }] : []) };
  put('leads', [l]); toast('Лид добавлен');
  const src = l.source; leadForm.reset(); leadForm.source.value = src; leadForm.name.focus();
});

// доска
const board = $('#board');
let dragId = null;
board.addEventListener('dragstart', e => { const c = e.target.closest('.lead'); if (!c) return; dragId = c.dataset.id; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
board.addEventListener('dragend', e => { e.target.closest('.lead')?.classList.remove('dragging'); $$('.col.over').forEach(x => x.classList.remove('over')); });
board.addEventListener('dragover', e => { const col = e.target.closest('.col'); if (!col || !dragId) return; e.preventDefault(); $$('.col.over').forEach(x => x !== col && x.classList.remove('over')); col.classList.add('over'); });
board.addEventListener('drop', e => {
  const col = e.target.closest('.col'); if (!col || !dragId) return; e.preventDefault();
  const id = dragId; dragId = null; moveLead(id, col.dataset.stage);
});
board.addEventListener('click', e => {
  if (e.target.closest('a')) return;
  const c = e.target.closest('.lead'); if (c) openLead(c.dataset.id);
});
function moveLead(id, stage) {
  const l = S.leads.find(x => x.id === id); if (!l || l.stage === stage) return;
  if (stage === 'Сделка') { openLead(id); setTimeout(() => $('#lmDeal').focus(), 50); return toast('Оформите продажу — лид перейдёт в «Сделку»'); }
  let lost = l.lost;
  if (stage === 'Отказ') { lost = (prompt('Причина отказа', l.lost || '') ?? '').trim(); if (!lost) return; }
  put('leads', [{ ...l, stage, lost, updated: nowIso(), by: whoAmI(),
    log: JSON.stringify([...leadLog(l), { ts: nowIso(), by: whoAmI(), text: `Этап: ${l.stage} → ${stage}` + (stage === 'Отказ' ? ` (${lost})` : '') }]) }]);
}

function renderCrm() {
  const q = $('#crmSearch').value.trim().toLowerCase(), qd = q.replace(/\D/g, '');
  const match = l => !q || [l.name, l.city, l.source, l.note].join(' ').toLowerCase().includes(q) || (qd.length >= 3 && phoneDigits(l.phone).includes(qd));
  const inPer = l => inP(String(l.created).slice(0, 10), 'crm');
  const shown = S.leads.filter(l => match(l) && (OPEN.includes(l.stage) || inPer(l) || (l.stage === 'Сделка' && saleIn(l))));
  const per = S.leads.filter(inPer);
  const deals = per.filter(l => l.stage === 'Сделка');
  const leadSales = S.opt.filter(r => r.lead && inP(r.date, 'crm'));
  const t = today();
  const due = S.leads.filter(l => OPEN.includes(l.stage) && l.next && l.next <= t).length;
  $('#crmKpis').innerHTML = kpi('Лидов за период', fmtN(per.length)) + kpi('В работе', fmtN(S.leads.filter(l => OPEN.includes(l.stage)).length)) +
    kpi('Позвонить сегодня', due ? `<span class="${S.leads.some(l => OPEN.includes(l.stage) && l.next && l.next < t) ? 'neg' : ''}">${due}</span>` : '0', 'включая просроченные') +
    kpi('Сделок', fmtN(deals.length), 'из лидов за период') + kpi('Конверсия в сделку', pct(deals.length, per.length)) +
    kpi('Выручка с лидов', fmt(sum(leadSales, 'sum')), `продаж: ${leadSales.length}`, 'hl');
  board.innerHTML = STAGES.map(st => {
    const ls = shown.filter(l => (l.stage || 'Новый') === st).sort((a, b) => OPEN.includes(st) ? String(a.next || '9').localeCompare(String(b.next || '9')) : String(b.updated).localeCompare(String(a.updated)));
    const money = st === 'Сделка' ? fmt(sum(ls, l => (S.opt.find(r => r.id === l.sale) || {}).sum || 0)) : '';
    return `<div class="col" data-stage="${st}"><div class="col-h"><span>${st} <span class="c">${ls.length}</span></span><span class="s">${money}</span></div>` +
      ls.map(l => `<div class="lead" draggable="true" data-id="${esc(l.id)}">
        <div class="ln">${esc(l.name || 'Без имени')}</div>
        <div class="lp"><a class="wa" href="${waLink(l.phone)}" target="_blank" rel="noopener">${esc(phoneFmt(l.phone))}</a>${l.city ? ' · ' + esc(l.city) : ''}</div>
        ${l.stage === 'Отказ' && l.lost ? `<div class="lnote">✕ ${esc(l.lost)}</div>` : l.note ? `<div class="lnote">${esc(l.note)}</div>` : ''}
        <div class="lmeta">${dueTag(l)}${l.source ? `<span class="tag src">${esc(l.source)}</span>` : ''}</div></div>`).join('') + '</div>';
  }).join('');
  // источники
  const src = {};
  per.forEach(l => { const k = l.source || 'Не указан'; const x = src[k] ||= { n: 0, deals: 0, rev: 0 }; x.n++; if (l.stage === 'Сделка') x.deals++; });
  leadSales.forEach(r => { const l = S.leads.find(x => x.id === r.lead); const k = (l && l.source) || 'Не указан'; (src[k] ||= { n: 0, deals: 0, rev: 0 }).rev += r.sum; });
  const sl = Object.entries(src).sort((a, b) => b[1].n - a[1].n);
  $('#crmSources').innerHTML = sl.length ? `<thead><tr><th>Источник / кампания</th><th class="n">Лидов</th><th class="n">Сделок</th><th class="n">Конверсия</th><th class="n">Выручка</th></tr></thead><tbody>` +
    sl.map(([k, x]) => `<tr><td>${esc(k)}</td><td class="n">${fmtN(x.n)}</td><td class="n">${fmtN(x.deals)}</td><td class="n">${pct(x.deals, x.n)}</td><td class="n">${fmt(x.rev)}</td></tr>`).join('') + '</tbody>'
    : '<tr><td class="empty">Лидов за период нет</td></tr>';
}
const saleIn = l => { const r = S.opt.find(x => x.id === l.sale); return r && inP(r.date, 'crm'); };

// карточка лида
const lm = $('#leadModal'), lmf = $('#lmForm');
$('#lmStage').innerHTML = STAGES.map(s => `<option>${s}</option>`).join('');
$('#lmStage').addEventListener('change', () => $('#lmLostWrap').classList.toggle('hidden', $('#lmStage').value !== 'Отказ'));
let lmPending = [];
function openLead(id) {
  const l = S.leads.find(x => x.id === id); if (!l) return;
  lmf.dataset.id = id; lmPending = [];
  ['name', 'city', 'source', 'next', 'lost'].forEach(k => lmf[k].value = l[k] || '');
  lmf.phone.value = phoneFmt(l.phone); lmf.stage.value = l.stage || 'Новый';
  $('#lmLostWrap').classList.toggle('hidden', lmf.stage.value !== 'Отказ');
  $('#lmTitle').textContent = (l.name || 'Лид') + ' · создан ' + ruDate(String(l.created).slice(0, 10));
  $('#lmWa').href = waLink(l.phone);
  const sale = S.opt.find(r => r.id === l.sale);
  $('#lmDeal').textContent = sale ? `Продажа: ${fmt(sale.sum)} — открыть` : 'Сделка → оформить продажу';
  renderLog(l); lm.classList.remove('hidden');
}
function renderLog(l) {
  const items = [...leadLog(l), ...lmPending].reverse();
  $('#lmLog').innerHTML = items.length ? items.map(x => `<div><small>${ruDate(String(x.ts).slice(0, 10))} ${String(x.ts).slice(11, 16)} · ${esc(x.by || '')}</small>${esc(x.text)}</div>`).join('') : '<div class="empty">Пока пусто</div>';
}
const closeLead = () => { lm.classList.add('hidden'); lmPending = []; };
$('#lmClose').addEventListener('click', closeLead);
lm.addEventListener('click', e => { if (e.target === lm) closeLead(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !lm.classList.contains('hidden')) closeLead(); });
function addNote() {
  const t = $('#lmNote').value.trim(); if (!t) return;
  lmPending.push({ ts: nowIso(), by: whoAmI(), text: t }); $('#lmNote').value = '';
  renderLog(S.leads.find(x => x.id === lmf.dataset.id));
}
$('#lmNoteAdd').addEventListener('click', addNote);
$('#lmNote').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addNote(); } });
function saveLead() {
  const l = S.leads.find(x => x.id === lmf.dataset.id); if (!l) return null;
  addNote();
  let stage = lmf.stage.value;
  if (stage === 'Сделка' && !l.sale) stage = l.stage === 'Сделка' ? 'Сделка' : l.stage;   // «Сделка» — только через продажу
  if (stage === 'Отказ' && !lmf.lost.value.trim()) { toast('Укажите причину отказа'); lmf.lost.focus(); return null; }
  const log = [...leadLog(l), ...lmPending];
  if (stage !== l.stage) log.push({ ts: nowIso(), by: whoAmI(), text: `Этап: ${l.stage} → ${stage}` });
  const last = lmPending.length ? lmPending[lmPending.length - 1].text : l.note;
  const n = { ...l, name: lmf.name.value.trim(), phone: phoneDigits(lmf.phone.value) || l.phone, city: lmf.city.value.trim(), source: lmf.source.value.trim(),
    stage, next: lmf.next.value, lost: stage === 'Отказ' ? lmf.lost.value.trim() : '', note: last, log: JSON.stringify(log), updated: nowIso(), by: whoAmI() };
  put('leads', [n]); lmPending = [];
  return n;
}
lmf.addEventListener('submit', e => { e.preventDefault(); if (saveLead()) { closeLead(); toast('Лид сохранён'); } });
$('#lmDeal').addEventListener('click', () => {
  const l = saveLead(); if (!l) return; closeLead();
  setSeg($('#optView'), 'sales'); render();
  const sale = S.opt.find(r => r.id === l.sale);
  if (sale) { $(`#optTable [data-act=edit][data-id="${sale.id}"]`)?.click(); return; }
  optReset(); optForm.dataset.lead = l.id;
  optForm.buyer.value = l.name || phoneFmt(l.phone); optForm.note.value = 'Лид ' + phoneFmt(l.phone) + (l.source ? ' · ' + l.source : '');
  $('#optFormTitle').textContent = 'Продажа по лиду: ' + (l.name || phoneFmt(l.phone)); $('#optCancel').classList.remove('hidden');
  optForm.scrollIntoView({ behavior: 'smooth' }); optForm.model.focus();
});
$('#lmDel').addEventListener('click', () => {
  const id = lmf.dataset.id; if (!confirm('Удалить лид совсем?')) return; closeLead(); del('leads', [id]);
});

/* ================= Фуры ================= */
const usd = n => '$' + (Math.round(n * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const truckForm = $('#truckForm');
function extraRow(n = '', v = '') {
  const d = document.createElement('div'); d.className = 'extra-row';
  d.innerHTML = `<input placeholder="Статья" value="${esc(n)}"><input type="number" step="any" placeholder="Сумма, $" value="${esc(v)}"><button type="button" class="icon-btn">✕</button>`;
  d.querySelector('button').onclick = () => d.remove(); $('#extraList').appendChild(d);
}
$('#extraAdd').addEventListener('click', () => extraRow());
// Товары в фуре: строки «модель + количество»
function goodsRow(m = '', q = '') {
  const d = document.createElement('div'); d.className = 'goods-row';
  d.innerHTML = `<input placeholder="Модель" list="dl-model" autocomplete="off" value="${esc(m)}"><input type="number" min="0" step="1" placeholder="Кол-во, шт" value="${esc(q)}"><button type="button" class="icon-btn" title="Убрать">✕</button>`;
  d.querySelector('button').onclick = () => { d.remove(); goodsTotal(); };
  d.addEventListener('input', goodsTotal);
  $('#goodsList').appendChild(d); goodsTotal(); return d;
}
function goodsTotal() {
  const q = $$('.goods-row', truckForm).reduce((s, d) => s + num($$('input', d)[1].value), 0);
  $('#goodsTotal').textContent = q ? `Всего: ${fmtN(q)} шт` : '';
}
$('#goodsAdd').addEventListener('click', () => goodsRow().querySelector('input').focus());
// старые записи были текстом «модель — кол-во» по строкам
const goodsOf = r => {
  if (Array.isArray(r.goods)) return r.goods;
  const t = String(r.goods || '').trim(); if (!t) return [];
  try { const a = JSON.parse(t); if (Array.isArray(a)) return a; } catch { }
  return t.split(/\n+/).map(l => { const m = l.match(/^(.*?)[\s—–:-]+(\d[\d\s]*)\s*(шт)?\s*$/); return m ? { model: m[1].trim(), qty: num(m[2]) } : { model: l.trim(), qty: 0 }; });
};
function truckReset() { truckForm.reset(); delete truckForm.dataset.id; truckForm.date.value = today(); $('#extraList').innerHTML = ''; $('#goodsList').innerHTML = ''; goodsRow(); setSeg($('[data-name=payStatus]', truckForm), 'Не оплачено');
  $('#truckFormTitle').textContent = 'Новая фура'; $('#truckCancel').classList.add('hidden'); }
truckReset();
$('#truckCancel').addEventListener('click', truckReset);
const extras = r => { try { return Array.isArray(r.extra) ? r.extra : JSON.parse(r.extra || '[]'); } catch { return []; } };
truckForm.addEventListener('submit', e => {
  e.preventDefault(); const id = truckForm.dataset.id;
  const goods = $$('.goods-row', truckForm).map(d => { const [a, b] = $$('input', d); return { model: a.value.trim(), qty: num(b.value) }; }).filter(x => x.model || x.qty);
  const extra = $$('.extra-row', truckForm).map(d => { const [a, b] = $$('input', d); return { name: a.value.trim(), amount: num(b.value) }; }).filter(x => x.name || x.amount);
  put('trucks', [{ id: id || uid(), date: truckForm.date.value, truck: truckForm.truck.value.trim(), contract: truckForm.contract.value.trim(), goods: JSON.stringify(goods),
    goodsSum: num(truckForm.goodsSum.value), payStatus: segVal($('[data-name=payStatus]', truckForm)), driver: num(truckForm.driver.value), customs: num(truckForm.customs.value), border: num(truckForm.border.value),
    extra: JSON.stringify(extra), note: truckForm.note.value.trim() }]);
  toast(id ? 'Фура изменена' : 'Фура сохранена'); truckReset();
});
$('#truckList').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return; const r = S.trucks.find(x => x.id === b.dataset.id); if (!r) return;
  if (b.dataset.act === 'edit') {
    truckReset(); truckForm.dataset.id = r.id;
    $('#goodsList').innerHTML = ''; const gl = goodsOf(r); (gl.length ? gl : [{}]).forEach(x => goodsRow(x.model || '', x.qty || ''));
    ['date', 'truck', 'contract', 'goodsSum', 'driver', 'customs', 'border', 'note'].forEach(k => truckForm[k].value = r[k] || '');
    setSeg($('[data-name=payStatus]', truckForm), r.payStatus || 'Не оплачено'); extras(r).forEach(x => extraRow(x.name, x.amount));
    $('#truckFormTitle').textContent = 'Правка фуры'; $('#truckCancel').classList.remove('hidden'); truckForm.scrollIntoView({ behavior: 'smooth' });
  } else if (confirm(`Удалить фуру «${r.truck}»?`)) del('trucks', [r.id]);
});
function renderTrucks() {
  const list = [...S.trucks].sort((a, b) => b.date.localeCompare(a.date));
  const ex = r => sum(extras(r), 'amount');
  const tot = r => r.goodsSum + r.driver + num(r.customs) + r.border + ex(r);
  $('#truckKpis').innerHTML = kpi('Фур', fmtN(list.length), `не оплачено: ${list.filter(r => r.payStatus !== 'Оплачено').length}`) +
    kpi('Товара в фурах', fmtN(sum(list, r => sum(goodsOf(r), 'qty'))) + ' шт') +
    kpi('Оплата за товар', usd(sum(list, 'goodsSum'))) + kpi('Оплата водителю', usd(sum(list, 'driver'))) + kpi('Растаможка', usd(sum(list, 'customs'))) +
    kpi('Китайцам на границе', usd(sum(list, 'border'))) + kpi('Доп. расходы', usd(sum(list, ex))) + kpi('Итого по фурам', usd(sum(list, tot)), '', 'hl');
  $('#truckList').innerHTML = list.length ? list.map(r => {
    const st = r.payStatus === 'Оплачено' ? 'paid' : r.payStatus === 'Частично' ? 'part' : 'warn';
    return `<div class="truck"><div class="t-head"><div><div class="t-name">🚛 ${esc(r.truck)}</div><div class="t-meta">${ruDate(r.date)}${r.contract ? ' · контракт ' + esc(r.contract) : ''}</div></div>
      <div><span class="tag ${st}">${esc(r.payStatus || 'Не оплачено')}</span>
      <button class="icon-btn owner-only" data-act="edit" data-id="${esc(r.id)}">✎</button><button class="icon-btn owner-only" data-act="del" data-id="${esc(r.id)}">🗑</button></div></div>
      ${(g => g.length ? `<table class="goods-t">${g.map(x => `<tr><td>${esc(x.model)}</td><td class="n">${fmtN(x.qty)} шт</td></tr>`).join('')}${g.length > 1 ? `<tr class="sum"><td>Всего</td><td class="n">${fmtN(sum(g, 'qty'))} шт</td></tr>` : ''}</table>` : '')(goodsOf(r))}
      <dl><dt>Оплата за товар</dt><dd>${usd(r.goodsSum)}</dd><dt>Оплата водителю</dt><dd>${usd(r.driver)}</dd><dt>Растаможка</dt><dd>${usd(num(r.customs))}</dd><dt>Китайцам на границе</dt><dd>${usd(r.border)}</dd>
      ${extras(r).map(x => `<dt>${esc(x.name)}</dt><dd>${usd(x.amount)}</dd>`).join('')}
      <dt class="total">Итого</dt><dd class="total">${usd(tot(r))}</dd></dl>${r.note ? `<div class="t-meta" style="margin-top:8px">${esc(r.note)}</div>` : ''}</div>`;
  }).join('') : '<div class="card empty">Фур пока нет</div>';
}

/* ================= Навигация и рендер ================= */
let current = lsGet('fnix_tab', 'kaspi');
function showTab(t) {
  current = t; lsSet('fnix_tab', t);
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  $$('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + t));
  render();
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });
function render() {
  fillDatalists();
  ({ kaspi: renderKaspi, cost: renderCost, dds: renderDds, pnl: renderPnl, opt: renderOpt, trucks: renderTrucks })[current]();
}

/* ================= Вход и роли ================= */
function applyRole() {
  document.body.classList.toggle('ro', RO());
  const b = $('#roleBadge');
  b.textContent = whoAmI(); b.classList.toggle('hidden', !remote || !pin);
  $('#logoutBtn').classList.toggle('hidden', !remote || !pin);
}
$('#logoutBtn').addEventListener('click', () => {
  if (outbox.length && !confirm(`Не все изменения дошли до Google (${outbox.length}). Всё равно выйти?`)) return;
  ['fnix_pin', 'fnix_role', 'fnix_state', 'fnix_outbox'].forEach(k => { try { localStorage.removeItem(k); } catch { } });
  location.reload();
});
function showLogin(msg = '') { $('#login').classList.remove('hidden'); $('#loginErr').textContent = msg; $('#pinInput').focus(); }
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); pin = $('#pinInput').value.trim(); if (!pin) return;
  $('#loginErr').textContent = 'Проверяю…';
  try { const ok = await loadRemote(); if (ok !== false) { lsSet(LS.pin, pin); $('#login').classList.add('hidden'); applyRole(); toast(RO() ? 'Вход: менеджер' : 'Вход: полный доступ'); } }
  catch { $('#loginErr').textContent = 'Нет связи с Google. Проверьте интернет.'; }
});

/* ================= Старт ================= */
const cached = lsGet(LS.state, null);
if (cached) Object.keys(S).forEach(k => S[k] = normalize(k, cached[k]));
applyRole();
showTab(current);
if (!remote) syncStatus();
else if (!pin) showLogin();
else loadRemote().catch(() => syncStatus());
window.addEventListener('online', flush);

/* ================= Снег ================= */
(function snow() {
  const c = $('#snow'), x = c.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w, h, flakes = [];
  const resize = () => { w = c.width = innerWidth * devicePixelRatio; h = c.height = innerHeight * devicePixelRatio; };
  resize(); addEventListener('resize', resize);
  const N = reduce ? 40 : Math.min(160, Math.round(innerWidth / 9));
  for (let i = 0; i < N; i++) flakes.push({ x: Math.random() * w, y: Math.random() * h, r: (Math.random() * 2.2 + .6) * devicePixelRatio, s: Math.random() * .8 + .3, d: Math.random() * Math.PI * 2, o: Math.random() * .6 + .3 });
  function draw() {
    x.clearRect(0, 0, w, h);
    flakes.forEach(f => {
      x.beginPath(); x.arc(f.x, f.y, f.r, 0, 7); x.fillStyle = `rgba(255,255,255,${f.o})`; x.fill();
      if (!reduce) { f.y += f.s * devicePixelRatio; f.d += .01; f.x += Math.sin(f.d) * .4 * devicePixelRatio;
        if (f.y > h + 5) { f.y = -5; f.x = Math.random() * w; } if (f.x > w + 5) f.x = -5; if (f.x < -5) f.x = w + 5; }
    });
    if (!reduce) requestAnimationFrame(draw);
  }
  draw();
})();
})();
