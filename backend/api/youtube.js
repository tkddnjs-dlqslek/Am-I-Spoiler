// /api/youtube — YouTube Data API + ad signal proxy

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { videoId, videoUrl } = req.body;
    const ytKey = process.env.YT_KEY;
    if (!ytKey) return res.status(500).json({ ok: false, error: 'YT_KEY not configured' });

    const [metaJson, koEndingComments, enEndingComments, hasAd] = await Promise.all([
      fetch(`https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet,contentDetails,statistics&key=${ytKey}`)
        .then(r => r.json()),
      fetchComments(videoId, ytKey, '결말', 30),
      fetchComments(videoId, ytKey, 'ending', 30),
      fetchAdSignal(videoUrl),
    ]);

    if (!metaJson.items || metaJson.items.length === 0) {
      return res.status(404).json({ ok: false, error: 'Video not found' });
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

    res.json({ ok: true, data: { ytData, hasAd } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
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

async function fetchAdSignal(videoUrl) {
  try {
    const res = await fetch(videoUrl);
    const html = await res.text();
    return html.includes('"adPlacements"') && !html.includes('"adPlacements":[]');
  } catch (_) {
    return null;
  }
}
