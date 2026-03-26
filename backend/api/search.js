// /api/search — Serper web search proxy (workTitle 기반 방영 정보)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { workTitle, lang } = req.body;
    const serperKey = process.env.SERPER_KEY;
    if (!serperKey || !workTitle) return res.json({ ok: true, data: '' });

    const q    = lang === 'ko' ? `${workTitle} 방영 완결 시즌` : `${workTitle} airing status seasons episodes`;
    const opts = lang === 'ko' ? { gl: 'kr', hl: 'ko' } : { gl: 'us', hl: 'en' };

    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperKey },
      body: JSON.stringify({ q, ...opts, num: 5 }),
    });
    const json = await r.json();
    if (!json.organic) return res.json({ ok: true, data: '' });

    const snippets = json.organic.slice(0, 5).map(r => `[${r.title}] ${r.snippet ?? ''}`).join('\n');
    res.json({ ok: true, data: snippets });
  } catch (_) {
    res.json({ ok: true, data: '' });
  }
}
