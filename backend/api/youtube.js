// /api/youtube — YouTube Data API proxy

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
    const { videoId } = await req.json();
    const ytKey = process.env.YT_KEY;
    if (!ytKey) return new Response(JSON.stringify({ ok: false, error: 'YT_KEY not configured' }), { status: 500, headers });

    const [metaJson, koEndingComments, enEndingComments] = await Promise.all([
      fetch(`https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet,contentDetails,statistics&key=${ytKey}`)
        .then(r => r.json()),
      fetchComments(videoId, ytKey, '결말', 30),
      fetchComments(videoId, ytKey, 'ending', 30),
    ]);

    if (!metaJson.items || metaJson.items.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'Video not found' }), { status: 404, headers });
    }

    const item = metaJson.items[0];
    const snippet = item.snippet;
    const duration = item.contentDetails?.duration ?? '';
    const viewCount = item.statistics?.viewCount ?? '0';
    const likeCount = item.statistics?.likeCount ?? '0';

    const bestCount = Math.max(koEndingComments.length, enEndingComments.length);
    const topComments = bestCount < 5 ? await fetchComments(videoId, ytKey, null, 20) : [];

    const ytData = {
      title: snippet.title,
      description: (snippet.description || '').slice(0, 500),
      publishedAt: snippet.publishedAt,
      duration,
      viewCount,
      likeCount,
      defaultLanguage: snippet.defaultLanguage || snippet.defaultAudioLanguage || '',
      koEndingComments,
      enEndingComments,
      topComments,
    };

    return new Response(JSON.stringify({ ok: true, data: { ytData } }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers });
  }
}

async function fetchComments(videoId, ytKey, searchTerms, maxResults) {
  try {
    let url = `https://www.googleapis.com/youtube/v3/commentThreads?videoId=${videoId}&order=relevance&maxResults=${maxResults}&part=snippet&key=${ytKey}`;
    if (searchTerms) url += `&searchTerms=${encodeURIComponent(searchTerms)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.items) return [];
    return json.items.map(c => {
      const top = c.snippet.topLevelComment.snippet;
      return { text: top.textDisplay, likes: top.likeCount };
    });
  } catch (_) {
    return [];
  }
}
