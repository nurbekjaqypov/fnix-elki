// Разбор голосовой фразы о продажах ёлок за день в количества по моделям (Claude).
// Переменная Netlify: ANTHROPIC_API_KEY. Без неё сайт разбирает фразу сам.
export const config = { path: '/api/parse-plan' };
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
  const models = (Array.isArray(b.models) ? b.models : []).slice(0, 40).map(String);
  if (!text.trim() || !models.length) return json({ ok: false, error: 'empty' }, 400);
  const system = `Ты разбираешь фразу о том, сколько искусственных ёлок продано за день, по моделям.
Сегодня ${b.today || ''}. Модели (пиши точно так): ${models.join(' | ')}.
Произношение: «джи» = G, «икс» = X, «эс джи» = SG, «люкс а/бэ» = LUX A/LUX B; числа после буквы — высота (180, 210, 240).
Верни ТОЛЬКО JSON: {"date":"YYYY-MM-DD или null","qty":{"<модель>":число,...}}. Количества словами переводи в числа. Не выдумывай модели, которых не назвали.`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env('ANTHROPIC_MODEL') || 'claude-haiku-5-5', max_tokens: 400, system, messages: [{ role: 'user', content: text }] })
    });
    const j = await r.json();
    if (!r.ok) return json({ ok: false, error: j.error?.message || 'api' });
    const m = (j.content || []).map(c => c.text || '').join('').match(/\{[\s\S]*\}/);
    if (!m) return json({ ok: false, error: 'parse' });
    const f = JSON.parse(m[0]); const qty = {};
    Object.entries(f.qty || {}).forEach(([k, v]) => { if (models.includes(k) && Number.isFinite(+v)) qty[k] = Math.round(+v); });
    return json({ ok: true, fields: { date: f.date || null, qty } });
  } catch (e) { return json({ ok: false, error: e.message }); }
};
