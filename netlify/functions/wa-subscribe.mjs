// Разовая настройка: подписывает наше приложение (FNIX Leads) на аккаунт WhatsApp с нужным номером,
// чтобы входящие сообщения шли на /api/whatsapp.
// Открыть: https://fnixelki.netlify.app/api/wa-subscribe?token=<WA_VERIFY_TOKEN>
// Переменные Netlify: META_SYSTEM_TOKEN (маркер системного пользователя), необязательно WA_PHONE (по умолчанию 77065190308)
export const config = { path: '/api/wa-subscribe' };
const env = k => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? '');
const BUSINESS_ID = '767511095022553';
const G = 'https://graph.facebook.com/v21.0';

const page = (title, body, ok) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="font:16px system-ui;background:#07121f;color:#eef3f7;padding:24px;max-width:760px;margin:auto"><h2 style="color:${ok ? '#4cc28a' : '#e05a52'}">${title}</h2><pre style="white-space:pre-wrap;line-height:1.5">${body}</pre></body>`,
  { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

async function g(path, token, opts = {}) {
  const r = await fetch(`${G}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, opts);
  const j = await r.json().catch(() => ({}));
  if (j.error) throw new Error(`${path.split('?')[0]}: ${j.error.message}`);
  return j;
}

export default async (req) => {
  const url = new URL(req.url);
  const verify = env('WA_VERIFY_TOKEN');
  if (!verify || url.searchParams.get('token') !== verify) return page('Не получилось', 'Неверный token в адресе.', false);
  const token = env('META_SYSTEM_TOKEN');
  if (!token) return page('Не получилось', 'В Netlify не задана переменная META_SYSTEM_TOKEN. Добавьте её и сделайте Trigger deploy.', false);
  const want = (env('WA_PHONE') || '77065190308').replace(/\D/g, '');
  const log = [];
  try {
    let wabas = [];
    for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
      try { const j = await g(`${BUSINESS_ID}/${edge}?fields=id,name&limit=100`, token); wabas = wabas.concat(j.data || []); } catch (e) { log.push('⚠ ' + e.message); }
    }
    if (!wabas.length) throw new Error('Маркер не видит ни одного аккаунта WhatsApp. Проверьте, что системному пользователю назначен аккаунт «Grantel Bikes».');
    let found = null;
    for (const w of wabas) {
      const ph = await g(`${w.id}/phone_numbers?fields=id,display_phone_number,verified_name,status,platform_type`, token).catch(e => { log.push('⚠ ' + e.message); return { data: [] }; });
      log.push(`Аккаунт «${w.name}» (${w.id}): ${(ph.data || []).map(p => p.display_phone_number).join(', ') || 'нет номеров'}`);
      const p = (ph.data || []).find(p => String(p.display_phone_number).replace(/\D/g, '') === want);
      if (p) { found = { w, p }; break; }
    }
    if (!found) throw new Error(`Номер ${want} не найден ни в одном доступном аккаунте.`);
    const sub = await g(`${found.w.id}/subscribed_apps`, token, { method: 'POST' });
    const list = await g(`${found.w.id}/subscribed_apps`, token);
    log.push('', `Номер: ${found.p.display_phone_number} · ${found.p.verified_name || ''} · статус ${found.p.status || '?'} · ${found.p.platform_type || ''}`,
      `Подписка: ${sub.success ? 'оформлена' : JSON.stringify(sub)}`,
      `Приложения на аккаунте: ${(list.data || []).map(a => a.whatsapp_business_api_data?.name || a.name || a.id).join(', ')}`);
    return page('Готово', log.join('\n'), true);
  } catch (e) {
    log.push('', '✕ ' + e.message);
    return page('Не получилось', log.join('\n'), false);
  }
};
