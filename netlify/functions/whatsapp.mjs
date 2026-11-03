// Приём входящих сообщений WhatsApp (WhatsApp Business Platform / Cloud API)
// и создание лидов в Google Таблице через Apps Script.
//
// Адрес вебхука для Meta:  https://fnixelki.netlify.app/api/whatsapp
// Переменные окружения Netlify:
//   WA_VERIFY_TOKEN  — любой секретный текст, тот же вписывается в Meta при настройке вебхука
//   META_APP_SECRET  — «Секрет приложения» из Meta for Developers (проверка подписи). Если сообщения
//                      пересылает партнёр Meta, можно не задавать — тогда в адресе нужен ?key=WA_VERIFY_TOKEN
//   SERVER_KEY       — ключ из журнала Apps Script (функция setup)
//   APPS_SCRIPT_URL  — необязательно, по умолчанию адрес из config.js
//   META_TOKEN       — необязательно: токен с правом ads_read, чтобы подставлять название кампании
import crypto from 'node:crypto';

const DEFAULT_API = 'https://script.google.com/macros/s/AKfycbxcViureBiW6OZHWny20G7Wpl1E_-ry1CwNu5V4mUHcalkxykajc1oGyoQ2TQGCJ31K/exec';

export const config = { path: '/api/whatsapp' };

const env = k => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? '');

function validSignature(raw, header, secret) {
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  const got = header.slice(7);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

function messageText(m) {
  switch (m.type) {
    case 'text': return m.text?.body || '';
    case 'button': return m.button?.text || '';
    case 'interactive': return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
    case 'image': return '[фото] ' + (m.image?.caption || '');
    case 'video': return '[видео] ' + (m.video?.caption || '');
    case 'document': return '[файл] ' + (m.document?.filename || '');
    case 'audio': return '[голосовое сообщение]';
    case 'location': return '[геолокация]';
    case 'sticker': return '[стикер]';
    default: return `[${m.type || 'сообщение'}]`;
  }
}

const adCache = new Map();
async function campaignName(adId) {
  const token = env('META_TOKEN');
  if (!token || !adId) return '';
  if (adCache.has(adId)) return adCache.get(adId);
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(adId)}?fields=name,campaign{name}&access_token=${encodeURIComponent(token)}`);
    const j = await r.json();
    const name = j.campaign?.name ? `${j.campaign.name} · ${j.name || ''}`.replace(/ · $/, '') : (j.name || '');
    adCache.set(adId, name);
    return name;
  } catch { return ''; }
}

export function extractLeads(body) {
  const out = [];
  for (const entry of body?.entry || []) {
    for (const ch of entry.changes || []) {
      if (ch.field !== 'messages') continue;
      const v = ch.value || {};
      const names = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, c.profile?.name || '']));
      for (const m of v.messages || []) {
        if (!m.from) continue;
        const ref = m.referral || null;
        out.push({
          phone: m.from,
          name: names[m.from] || '',
          text: messageText(m).trim(),
          adId: ref?.source_id || '',
          adUrl: ref?.source_url || '',
          ctwa: ref?.ctwa_clid || '',
          headline: ref?.headline || '',
          fromAd: !!ref
        });
      }
    }
  }
  return out;
}

export default async (req) => {
  const url = new URL(req.url);
  const verify = env('WA_VERIFY_TOKEN');

  // Подтверждение вебхука в Meta
  if (req.method === 'GET') {
    if (url.searchParams.get('hub.mode') === 'subscribe' && verify && url.searchParams.get('hub.verify_token') === verify) {
      return new Response(url.searchParams.get('hub.challenge') || '', { status: 200 });
    }
    return new Response('forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('method', { status: 405 });

  const raw = await req.text();
  const secret = env('META_APP_SECRET');
  if (secret) {
    if (!validSignature(raw, req.headers.get('x-hub-signature-256'), secret)) {
      console.error('Отклонено: подпись не совпала — проверьте META_APP_SECRET (секрет приложения в Meta)');
      return new Response('bad signature', { status: 401 });
    }
  } else if (!verify || url.searchParams.get('key') !== verify) {
    console.error('Отклонено: не задан META_APP_SECRET в Netlify (а ключа ?key= в адресе нет)');
    return new Response('forbidden', { status: 403 });
  }

  let body;
  try { body = JSON.parse(raw); } catch { return new Response('ok'); }
  const leads = extractLeads(body);
  console.log(`Получено сообщений: ${leads.length}`);
  if (!env('SERVER_KEY')) console.error('Не задан SERVER_KEY в Netlify');
  const api = env('APPS_SCRIPT_URL') || DEFAULT_API;
  const key = env('SERVER_KEY');

  let failed = 0;
  for (const l of leads) {
    let source = 'WhatsApp (без рекламы)';
    if (l.fromAd) {
      const camp = await campaignName(l.adId);
      source = 'Реклама WhatsApp: ' + (camp || l.headline || l.adId || 'объявление');
    }
    try {
      const r = await fetch(api, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'lead_in', key, lead: { ...l, source } })
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) { failed++; console.error('Apps Script:', JSON.stringify(j)); }
      else console.log('Лид записан:', JSON.stringify(j));
    } catch (e) { failed++; console.error('Apps Script недоступен:', e.message); }
  }
  // 200 — принято; при ошибке отвечаем 500, и Meta повторит доставку позже (дубли лидов не создаются)
  return new Response(failed ? 'retry' : 'ok', { status: failed ? 500 : 200 });
};
