// /api/search — Serper web search proxy (workTitle 기반 방영 정보)

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  try {
    const { workTitle, lang } = await req.json();
    const serperKey = process.env.SERPER_KEY;
    if (!serperKey || !workTitle) return new Response(JSON.stringify({ ok: true, data: '' }), { headers });

    const q    = lang === 'ko' ? `${workTitle} 방영 완결 시즌` : `${workTitle} airing status seasons episodes`;
    const opts = lang === 'ko' ? { gl: 'kr', hl: 'ko' } : { gl: 'us', hl: 'en' };

    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperKey },
      body: JSON.stringify({ q, ...opts, num: 5 }),
    });
    const json = await r.json();
    if (!json.organic) return new Response(JSON.stringify({ ok: true, data: '' }), { headers });

    const snippets = json.organic.slice(0, 5).map(r => `[${r.title}] ${r.snippet ?? ''}`).join('\n');
    return new Response(JSON.stringify({ ok: true, data: snippets }), { headers });
  } catch (_) {
    return new Response(JSON.stringify({ ok: true, data: '' }), { headers });
  }
}
