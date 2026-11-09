// Разбор голосовой/текстовой фразы о расходе в поля ДДС с помощью Claude.
// Переменная Netlify: ANTHROPIC_API_KEY. Без неё сайт разбирает фразу сам (попроще).
export const config = { path: '/api/parse-dds' };
const env = k => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? '');
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  const origin = req.headers.get('origin') || '';
  if (origin && !/fnixelki\.netlify\.app$|localhost/.test(origin)) return json({ ok: false, error: 'origin' }, 403);
  const key = env('ANTHROPIC_API_KEY');
  if (!key) return json({ ok: false, error: 'nokey' });
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: 'body' }, 400); }
  const text = String(b.text || '').slice(0, 600);
  if (!text.trim()) return json({ ok: false, error: 'empty' }, 400);
  const k = b.known || {};
  const list = a => (Array.isArray(a) ? a : []).slice(0, 60).map(x => String(x).slice(0, 60)).join(' | ') || '—';
  const system = `Ты разбираешь фразу бухгалтера о расходе компании (продажа новогодних ёлок, Казахстан) в поля учёта ДДС.
Сегодня ${b.today || ''}. Верни ТОЛЬКО JSON без пояснений:
{"date":"YYYY-MM-DD или null","channel":"Kaspi|WB|Опт|Общее или null","kind":"Постоянный|Переменный или null","item":"статья расхода или null","counterparty":"кому платили или null","payment":"способ оплаты или null","amount":число_в_тенге_или_null,"purpose":"назначение или null","trees":true|false|null}
Правила: суммы словами переводи в число («пятьдесят тысяч» = 50000, «полтора миллиона» = 1500000). «вчера»/«позавчера»/даты — в YYYY-MM-DD.
Канал: Kaspi/каспи-магазин → Kaspi; Wildberries/ВБ → WB; опт → Опт; иначе Общее, если не сказано — null. Но «Kaspi Gold», «Kaspi Bank», «через каспи», «каспи переводом» — это способ оплаты, а не канал.
Аренда, зарплата, связь, подписки обычно Постоянный; закуп, упаковка, доставка, реклама обычно Переменный — ставь, только если уверен.
trees=true, если расход явно связан с ёлками.
Если похоже на уже существующее значение — пиши его точно как в списке.
Статьи: ${list(k.items)}
Контрагенты: ${list(k.counterparties)}
Способы оплаты: ${list(k.payments)}`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env('ANTHROPIC_MODEL') || 'claude-haiku-5-5', max_tokens: 400, system, messages: [{ role: 'user', content: text }] })
    });
    const j = await r.json();
    if (!r.ok) return json({ ok: false, error: j.error?.message || 'api' });
    const out = (j.content || []).map(c => c.text || '').join('');
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return json({ ok: false, error: 'parse' });
    return json({ ok: true, fields: JSON.parse(m[0]) });
  } catch (e) { return json({ ok: false, error: e.message }); }
};
