// Разовая настройка: прописывает адрес нашего вебхука в 360dialog.
// Открыть в браузере: https://fnixelki.netlify.app/api/wa-setup?token=<WA_VERIFY_TOKEN>
// Нужна переменная Netlify D360_API_KEY — API-ключ номера из кабинета 360dialog.
export const config = { path: '/api/wa-setup' };
const env = k => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? '');

export default async (req) => {
  const url = new URL(req.url);
  const verify = env('WA_VERIFY_TOKEN');
  const html = (msg, ok) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="font:16px system-ui;background:#07121f;color:#eef3f7;padding:32px"><h2 style="color:${ok ? '#4cc28a' : '#e05a52'}">${ok ? 'Готово' : 'Не получилось'}</h2><pre style="white-space:pre-wrap">${msg}</pre></body>`,
    { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  if (!verify || url.searchParams.get('token') !== verify) return html('Неверный token в адресе.', false);
  const apiKey = env('D360_API_KEY');
  if (!apiKey) return html('В Netlify не задана переменная D360_API_KEY (API-ключ из кабинета 360dialog). Добавьте её и сделайте Trigger deploy.', false);
  const hook = `${url.origin}/api/whatsapp?key=${encodeURIComponent(verify)}`;
  try {
    const r = await fetch('https://waba-v2.360dialog.io/v1/configs/webhook', {
      method: 'POST', headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: hook })
    });
    const t = await r.text();
    return html(`Ответ 360dialog (${r.status}):\n${t}\n\nАдрес вебхука: ${url.origin}/api/whatsapp`, r.ok);
  } catch (e) { return html('Нет связи с 360dialog: ' + e.message, false); }
};
