// /api/ott — TMDB Watch Providers + Serper fallback proxy

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { title, lang } = req.body;
    const tmdbKey   = process.env.TMDB_KEY;
    const serperKey = process.env.SERPER_KEY;
    const region    = lang === 'ko' ? 'KR' : 'US';

    // TMDB 우선
    if (tmdbKey) {
      const hit = await tmdbSearch(title, tmdbKey);
      if (hit) {
        const platforms = await tmdbWatchProviders(hit.id, hit.mediaType, tmdbKey, region);
        if (platforms) return res.json({ ok: true, data: platforms });
      }
    }

    // Serper fallback
    if (serperKey) {
      const snippets = await ottSearch(title, serperKey, lang);
      const platforms = extractOttFromSnippets(snippets, lang);
      return res.json({ ok: true, data: platforms });
    }

    res.json({ ok: true, data: null });
  } catch (_) {
    res.json({ ok: true, data: null });
  }
}

async function tmdbSearch(title, tmdbKey) {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(title)}&language=ko-KR&api_key=${tmdbKey}`
    );
    const json = await res.json();
    const hit = json.results?.find(r => r.media_type === 'movie' || r.media_type === 'tv');
    if (!hit) return null;
    return { id: hit.id, mediaType: hit.media_type };
  } catch (_) { return null; }
}

async function tmdbWatchProviders(id, mediaType, tmdbKey, region) {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/${mediaType}/${id}/watch/providers?api_key=${tmdbKey}`
    );
    const json = await res.json();
    const regionData = json.results?.[region];
    if (!regionData) return null;
    const providers = regionData.flatrate ?? regionData.rent ?? regionData.buy ?? [];
    if (!providers.length) return null;
    return providers.map(p => p.provider_name).join(', ');
  } catch (_) { return null; }
}

async function ottSearch(title, serperKey, lang) {
  try {
    const q    = lang === 'ko' ? `${title} 넷플릭스 티빙 웨이브 왓챠 어디서` : `${title} where to stream`;
    const opts = lang === 'ko' ? { gl: 'kr', hl: 'ko' } : { gl: 'us', hl: 'en' };
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperKey },
      body: JSON.stringify({ q, ...opts, num: 5 }),
    });
    const json = await res.json();
    if (!json.organic) return '';
    return json.organic.slice(0, 5).map(r => `[${r.title}] ${r.snippet ?? ''}`).join('\n');
  } catch (_) { return ''; }
}

function extractOttFromSnippets(snippets, lang) {
  const OTT_MAP = lang === 'ko' ? {
    'netflix': 'Netflix', '넷플릭스': 'Netflix',
    'tving': 'Tving', '티빙': 'Tving',
    'wavve': 'Wavve', '웨이브': 'Wavve',
    'watcha': 'Watcha', '왓챠': 'Watcha',
    'coupang play': 'Coupang Play', '쿠팡플레이': 'Coupang Play',
    'disney+': 'Disney+', '디즈니플러스': 'Disney+',
    'apple tv+': 'Apple TV+',
    'amazon prime': 'Amazon Prime', 'prime video': 'Amazon Prime',
  } : {
    'netflix': 'Netflix',
    'disney+': 'Disney+', 'disney plus': 'Disney+',
    'max': 'Max', 'hbo max': 'Max',
    'hulu': 'Hulu',
    'apple tv+': 'Apple TV+', 'apple tv plus': 'Apple TV+',
    'amazon prime': 'Amazon Prime', 'prime video': 'Amazon Prime',
    'peacock': 'Peacock',
    'paramount+': 'Paramount+', 'paramount plus': 'Paramount+',
    'crunchyroll': 'Crunchyroll',
  };
  const lower = snippets.toLowerCase();
  const found = new Set();
  for (const [kw, name] of Object.entries(OTT_MAP)) {
    if (lower.includes(kw)) found.add(name);
  }
  return found.size > 0 ? [...found].join(', ') : null;
}
