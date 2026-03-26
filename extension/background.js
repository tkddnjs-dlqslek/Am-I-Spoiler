// background.js — Service Worker
// 모든 외부 API 호출은 여기서만 실행 (API 키 노출 방지)

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'ANALYZE') {
    const tabId = sender.tab.id;
    handleAnalyze(request.videoId, request.videoUrl, tabId)
      .then(result => sendResponse({ ok: true, data: result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// 진행 상황을 content script에 전달
function sendProgress(tabId, videoId, message) {
  chrome.tabs.sendMessage(tabId, { type: 'PROGRESS', videoId, message }).catch(() => {});
}


// ─── 메인 분석 함수 ───────────────────────────────────────────────────────────

async function handleAnalyze(videoId, videoUrl, tabId) {
  const keys = await getKeys();

  if (!keys.claudeKey) throw new Error('Claude API key is not set. Click the extension icon to configure.');
  if (!keys.ytKey)     throw new Error('YouTube API key is not set. Click the extension icon to configure.');

  console.group(`[Spoiler AI] ${videoId}`);

  // 1. YouTube data + ad signal 병렬 요청
  sendProgress(tabId, videoId, 'Fetching video info...');
  const [ytData, hasAd] = await Promise.all([
    getYouTubeData(videoId, keys.ytKey),
    fetchAdSignal(videoUrl),
  ]);
  // 영상 언어 감지 (분석/검색 방향)
  const lang = detectLang(ytData);
  // 출력 언어 = 영상 언어 (한글 제목 → 한국어 출력, 영어 제목 → 영어 출력)
  const outputLang = lang;
  const endingComments = lang === 'ko' ? ytData.koEndingComments : ytData.enEndingComments;
  const ytDataForClaude = { ...ytData, endingComments };

  console.log('[1] YouTube data', {
    title: ytData.title,
    lang,
    outputLang,
    publishedAt: ytData.publishedAt,
    duration: ytData.duration,
    viewCount: ytData.viewCount,
    koEndingComments: ytData.koEndingComments.length,
    enEndingComments: ytData.enEndingComments.length,
    topComments: ytData.topComments.length,
  });
  console.log('[2] Has ad:', hasAd);

  // 2. Web search (결말/방영 정보용) — lang 기반 쿼리
  let searchSnippets = '';
  if (keys.braveKey) {
    sendProgress(tabId, videoId, 'Searching the web...');
    searchSnippets = await braveSearch(ytData.title, keys.braveKey, lang);
    console.log('[2] Web search:\n', searchSnippets);
  }

  // 3. Claude 분석 → workTitle 추출
  sendProgress(tabId, videoId, 'thinking...');
  const result = await askClaude(ytDataForClaude, hasAd, searchSnippets, keys.claudeKey, lang, outputLang);
  console.log('[3] Claude output:', result);

  // 4. Claude가 뽑은 workTitle로 OTT 조회 — lang 기반 region
  if (keys.tmdbKey || keys.braveKey) {
    const searchTitle = result.workTitle || ytData.title;
    const ottResult = await getOttPlatforms(searchTitle, keys.tmdbKey, keys.braveKey, lang);
    if (ottResult.direct) {
      result.ottPlatforms = ottResult.direct;
      console.log('[4] OTT (TMDB direct):', result.ottPlatforms);
    } else if (ottResult.snippets) {
      result.ottPlatforms = extractOttFromSnippets(ottResult.snippets, lang) || null;
      console.log('[4] OTT (Serper keywords):', result.ottPlatforms);
    }
  }
  console.groupEnd();

  return { ...result, hasAd };
}


// ─── API 키 로드 ──────────────────────────────────────────────────────────────

function getKeys() {
  return new Promise(resolve => {
    chrome.storage.local.get(['claudeKey', 'ytKey', 'braveKey', 'tmdbKey'], resolve);
  });
}


// ─── YouTube Data API ─────────────────────────────────────────────────────────

async function getYouTubeData(videoId, ytKey) {
  // 메타데이터 + ko/en 결말 댓글 동시 수집
  const [metaJson, koEndingComments, enEndingComments] = await Promise.all([
    fetch(`https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet,contentDetails,statistics&key=${ytKey}`)
      .then(r => r.json()),
    fetchComments(videoId, ytKey, '결말', 30),
    fetchComments(videoId, ytKey, 'ending', 30),
  ]);

  if (!metaJson.items || metaJson.items.length === 0) {
    throw new Error('YouTube API: 영상 정보를 가져오지 못했습니다.');
  }

  const item = metaJson.items[0];
  const snippet = item.snippet;
  const duration = item.contentDetails?.duration ?? '';
  const viewCount = item.statistics?.viewCount ?? '0';
  const likeCount = item.statistics?.likeCount ?? '0';

  // 두 댓글 세트 모두 부족할 때만 일반 상위 댓글 보완
  const bestCount = Math.max(koEndingComments.length, enEndingComments.length);
  const topComments = bestCount < 5
    ? await fetchComments(videoId, ytKey, null, 20)
    : [];

  return {
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
}

// 영상 언어 감지: YouTube API 필드 → Hangul 감지 fallback
function detectLang(ytData) {
  const lang = ytData.defaultLanguage || '';
  if (lang.startsWith('ko')) return 'ko';
  if (lang && !lang.startsWith('ko')) return 'en';
  return /[\uAC00-\uD7AF]/.test(ytData.title) ? 'ko' : 'en';
}


// ─── 댓글 수집 헬퍼 ──────────────────────────────────────────────────────────

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


// ─── 광고 유무 감지 ───────────────────────────────────────────────────────────

async function fetchAdSignal(videoUrl) {
  try {
    const res = await fetch(videoUrl);
    const html = await res.text();
    // adPlacements 배열이 비어있지 않으면 광고 있음
    return html.includes('"adPlacements"') && !html.includes('"adPlacements":[]');
  } catch (_) {
    return null; // 판단 불가
  }
}


// ─── Serper Search API ────────────────────────────────────────────────────────

async function braveSearch(title, serperKey, lang = 'en') {
  const q    = lang === 'ko' ? `${title} 결말 방영`            : `${title} ending spoilers complete review`;
  const opts = lang === 'ko' ? { gl: 'kr', hl: 'ko' }         : { gl: 'us', hl: 'en' };
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': serperKey
      },
      body: JSON.stringify({ q, ...opts, num: 5 })
    });
    const json = await res.json();
    if (!json.organic) return '';

    return json.organic
      .slice(0, 5)
      .map(r => `[${r.title}] ${r.snippet ?? ''}`)
      .join('\n');
  } catch (_) {
    return '';
  }
}

// ─── TMDB Watch Providers ─────────────────────────────────────────────────────

async function tmdbSearch(title, tmdbKey) {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(title)}&language=ko-KR&api_key=${tmdbKey}`
    );
    const json = await res.json();
    const hit = json.results?.find(r => r.media_type === 'movie' || r.media_type === 'tv');
    if (!hit) return null;
    return { id: hit.id, mediaType: hit.media_type };
  } catch (_) {
    return null;
  }
}

async function tmdbWatchProviders(id, mediaType, tmdbKey, region = 'US') {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/${mediaType}/${id}/watch/providers?api_key=${tmdbKey}`
    );
    const json = await res.json();
    const regionData = json.results?.[region];
    if (!regionData) return null;
    // flatrate = 구독형 우선, 없으면 rent/buy 순
    const providers = regionData.flatrate ?? regionData.rent ?? regionData.buy ?? [];
    if (!providers.length) return null;
    return providers.map(p => p.provider_name).join(', ');
  } catch (_) {
    return null;
  }
}

// TMDB 우선 조회 → 결과 없으면 Serper OTT 검색으로 폴백
// 반환: { direct: string|null, snippets: string }
async function getOttPlatforms(title, tmdbKey, serperKey, lang = 'en') {
  const region = lang === 'ko' ? 'KR' : 'US';
  if (tmdbKey) {
    const hit = await tmdbSearch(title, tmdbKey);
    if (hit) {
      const platforms = await tmdbWatchProviders(hit.id, hit.mediaType, tmdbKey, region);
      if (platforms) return { direct: platforms, snippets: '' };
    }
  }
  if (serperKey) {
    const snippets = await ottSearch(title, serperKey, lang);
    return { direct: null, snippets };
  }
  return { direct: null, snippets: '' };
}


async function ottSearch(title, serperKey, lang = 'en') {
  const q    = lang === 'ko' ? `${title} 넷플릭스 티빙 웨이브 왓챠 어디서`  : `${title} where to stream`;
  const opts = lang === 'ko' ? { gl: 'kr', hl: 'ko' }                       : { gl: 'us', hl: 'en' };
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': serperKey
      },
      body: JSON.stringify({ q, ...opts, num: 5 })
    });
    const json = await res.json();
    if (!json.organic) return '';

    return json.organic
      .slice(0, 5)
      .map(r => `[${r.title}] ${r.snippet ?? ''}`)
      .join('\n');
  } catch (_) {
    return '';
  }
}


// ─── Claude API ───────────────────────────────────────────────────────────────

function extractOttFromSnippets(snippets, lang = 'en') {
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

async function askClaude(ytData, hasAd, searchSnippets, claudeKey, lang = 'en', outputLang = 'en') {
  const formatComments = (list) =>
    list.length > 0
      ? list.map((c, i) => `${i + 1}. [likes: ${c.likes}] ${c.text}`).join('\n')
      : 'none';

  const endingCommentsText = formatComments(ytData.endingComments);
  const topCommentsText    = ytData.topComments.length > 0
    ? formatComments(ytData.topComments)
    : null;

  const adText = hasAd === null ? 'unknown' : (hasAd ? 'yes' : 'no');

  const userContent = `
[Video Title]
${ytData.title}

[Video Description]
${ytData.description}

[Upload Date]
${ytData.publishedAt}

[Duration]
${ytData.duration}

[Has Ads]
${adText}

[Comments containing "${lang === 'ko' ? '결말' : 'ending'}" — up to 30, sorted by likes — primary signal]
${endingCommentsText}
${topCommentsText ? `\n[Top comments (supplementary)]\n${topCommentsText}` : ''}

[Web Search Results — ending/airing]
${searchSnippets || 'No results'}
`.trim();

  const systemPrompt = `You are an expert at analyzing whether a YouTube review video covers the ending of a movie, drama, webtoon, or manga.

Use these criteria to decide:
- If comments complain "no ending", "cut off in the middle", "where's part 2", "cliffhanger" → likely NO ending
- If the title contains words like "ending", "finale", "complete", "final episode", "결말", "완결", "엔딩" → likely HAS ending
- If the title contains "part 1", "review 1", "first half", "1부", "전편" → likely NO ending
- If the work is currently airing/in theaters → ending unlikely to be covered
- If duration is very short (under PT10M) → likely a partial review
- Ads are NOT a reliable signal: they appear due to creator monetization, Content ID claims by studios, or YouTube's own ad system — ignore this field for the verdict
${lang === 'ko'
  ? '- Note: comments are in Korean. "결말 없음" = no ending, "1부냐" = is this part 1?, "중간에 끊음" = cuts off midway, "2편 언제" = when is part 2'
  : '- Note: comments are in English. Look for phrases like "no ending", "cliffhanger", "part 1 only", "cuts off", "where\'s the rest"'}

For workTitle, cast, synopsis:
- Only fill these in if the work title is clearly stated in the video title or description
- If the title is only inferrable from comments, require 3 or more comments to mention the same work title before filling in workTitle
- If uncertain, set workTitle/cast/synopsis to null — it is better to return null than to guess incorrectly

${outputLang === 'ko'
  ? 'All text output fields (reason, synopsis, cast, workTitle) must be written in Korean (한국어).'
  : 'All text output fields (reason, synopsis, cast, workTitle) must be written in English.'}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: systemPrompt,
      tools: [{
        name: 'spoiler_result',
        description: 'Returns the structured analysis result of the video.',
        input_schema: {
          type: 'object',
          properties: {
            verdict: {
              type: 'string',
              enum: ['contains_ending', 'no_ending', 'uncertain'],
              description: 'Whether the video covers the ending of the work'
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'Confidence level of the verdict'
            },
            reason: {
              type: 'string',
              description: `Reasoning in 1–2 sentences (in ${outputLang === 'ko' ? 'Korean' : 'English'})`
            },
            workTitle: {
              type: ['string', 'null'],
              description: 'Title of the reviewed work. null if unknown'
            },
            cast: {
              type: ['string', 'null'],
              description: 'Main cast members. null if unknown'
            },
            synopsis: {
              type: ['string', 'null'],
              description: '2–3 sentence synopsis of the work (in English). null if unknown'
            },
            isAiring: {
              type: ['boolean', 'null'],
              description: 'true if currently airing/in theaters, false if finished, null if unknown'
            },
          },
          required: ['verdict', 'confidence', 'reason']
        }
      }],
      tool_choice: { type: 'tool', name: 'spoiler_result' },
      messages: [{ role: 'user', content: userContent }]
    })
  });

  const json = await res.json();
  if (json.error) throw new Error(`Claude API error: ${json.error.message}`);

  const toolUse = json.content?.find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('Claude API: unexpected response format');

  return toolUse.input;
}
