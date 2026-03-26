/**
 * Spoiler AI — Accuracy Test Script
 *
 * 사용법:
 *   node accuracy_test.js
 *   또는 환경변수: CLAUDE_KEY=sk-ant-xxx YT_KEY=AIzaxx node accuracy_test.js
 *
 * 결과: 카테고리별 정확도 + 전체 정확도 출력
 * Node 18+ 필요 (native fetch)
 */

// ─── API 키 설정 ─────────────────────────────────────────────────────────────
const CONFIG = {
  claudeKey: process.env.CLAUDE_KEY || '',   // console.anthropic.com
  ytKey:     process.env.YT_KEY     || '',   // Google Cloud Console
  serperKey: process.env.SERPER_KEY || '',   // serper.dev (optional)
  tmdbKey:   process.env.TMDB_KEY   || '',   // themoviedb.org (optional)
};

// ─── 테스트 케이스 ────────────────────────────────────────────────────────────
// url:      YouTube 영상 URL (https://www.youtube.com/watch?v=...)
// expected: 'contains_ending' | 'no_ending' | 'uncertain'
// category: 그룹명 (결과 표에 표시)
// notes:    선택 메모
const TEST_CASES = [
  // ── 결말 포함 확실 케이스 (제목에 결말/완결/엔딩 포함) ─────────────────────
  { url: '', expected: 'contains_ending', category: '결말 포함 확실', notes: '' },
  { url: '', expected: 'contains_ending', category: '결말 포함 확실', notes: '' },
  { url: '', expected: 'contains_ending', category: '결말 포함 확실', notes: '' },
  { url: '', expected: 'contains_ending', category: '결말 포함 확실', notes: '' },
  { url: '', expected: 'contains_ending', category: '결말 포함 확실', notes: '' },

  // ── 결말 없음 확실 케이스 (제목에 1부/전편/파트1 포함) ─────────────────────
  { url: '', expected: 'no_ending', category: '결말 없음 확실', notes: '' },
  { url: '', expected: 'no_ending', category: '결말 없음 확실', notes: '' },
  { url: '', expected: 'no_ending', category: '결말 없음 확실', notes: '' },
  { url: '', expected: 'no_ending', category: '결말 없음 확실', notes: '' },
  { url: '', expected: 'no_ending', category: '결말 없음 확실', notes: '' },

  // ── 애매한 케이스 (일반 리뷰, 제목만으론 판단 불가) ────────────────────────
  { url: 'https://www.youtube.com/watch?v=WotpfEbAflg', expected: 'contains_ending', category: '애매 케이스', notes: '' },
  { url: '', expected: 'no_ending',       category: '애매 케이스', notes: '' },
  { url: '', expected: 'contains_ending', category: '애매 케이스', notes: '' },
  { url: '', expected: 'no_ending',       category: '애매 케이스', notes: '' },
  { url: '', expected: 'contains_ending', category: '애매 케이스', notes: '' },

  // ── 방영 중 드라마 케이스 ──────────────────────────────────────────────────
  { url: '', expected: 'no_ending', category: '방영 중', notes: '' },
  { url: '', expected: 'no_ending', category: '방영 중', notes: '' },
  { url: '', expected: 'no_ending', category: '방영 중', notes: '' },
  { url: '', expected: 'no_ending', category: '방영 중', notes: '' },
  { url: '', expected: 'no_ending', category: '방영 중', notes: '' },
];

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
function extractVideoId(url) {
  try {
    const u = new URL(url);
    const v = u.searchParams.get('v');
    if (v) return v;
    const m = u.pathname.match(/^\/(shorts|live)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[2];
  } catch (_) {}
  return null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── YouTube Data API ─────────────────────────────────────────────────────────
async function getYouTubeData(videoId, ytKey) {
  // 메타데이터 + 결말 댓글 병렬 요청
  const [metaJson, endingComments] = await Promise.all([
    fetch(`https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet,contentDetails,statistics&key=${ytKey}`)
      .then(r => r.json()),
    fetchComments(videoId, ytKey, '결말', 50),
  ]);

  if (!metaJson.items?.length) throw new Error('YouTube API: video not found');

  const item     = metaJson.items[0];
  const snippet  = item.snippet;
  const duration = item.contentDetails?.duration ?? '';
  const viewCount = item.statistics?.viewCount ?? '0';

  const topComments = endingComments.length < 5
    ? await fetchComments(videoId, ytKey, null, 20)
    : [];

  return {
    title: snippet.title,
    description: (snippet.description || '').slice(0, 500),
    publishedAt: snippet.publishedAt,
    duration,
    viewCount,
    endingComments,
    topComments,
  };
}

async function fetchComments(videoId, ytKey, searchTerms, maxResults) {
  try {
    let url = `https://www.googleapis.com/youtube/v3/commentThreads?videoId=${videoId}&order=relevance&maxResults=${maxResults}&part=snippet&key=${ytKey}`;
    if (searchTerms) url += `&searchTerms=${encodeURIComponent(searchTerms)}`;
    const res  = await fetch(url);
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

async function tmdbWatchProviders(id, mediaType, tmdbKey) {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/${mediaType}/${id}/watch/providers?api_key=${tmdbKey}`
    );
    const json = await res.json();
    const kr = json.results?.KR;
    if (!kr) return null;
    const providers = kr.flatrate ?? kr.rent ?? kr.buy ?? [];
    if (!providers.length) return null;
    return providers.map(p => p.provider_name).join(', ');
  } catch (_) {
    return null;
  }
}

async function getOttPlatforms(title, tmdbKey, serperKey) {
  if (tmdbKey) {
    const hit = await tmdbSearch(title, tmdbKey);
    if (hit) {
      const platforms = await tmdbWatchProviders(hit.id, hit.mediaType, tmdbKey);
      if (platforms) return { direct: platforms, snippets: '' };
    }
  }
  if (serperKey) {
    const snippets = await ottSearch(title, serperKey);
    return { direct: null, snippets };
  }
  return { direct: null, snippets: '' };
}

// ─── Serper 웹 검색 ───────────────────────────────────────────────────────────
async function webSearch(title, serperKey) {
  if (!serperKey) return '';
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperKey },
      body: JSON.stringify({ q: `${title} 결말 방영`, gl: 'kr', hl: 'ko', num: 5 }),
    });
    const json = await res.json();
    if (!json.organic) return '';
    return json.organic.slice(0, 5).map(r => `[${r.title}] ${r.snippet ?? ''}`).join('\n');
  } catch (_) {
    return '';
  }
}

async function ottSearch(title, serperKey) {
  if (!serperKey) return '';
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperKey },
      body: JSON.stringify({ q: `${title} where to watch streaming OTT`, gl: 'kr', hl: 'ko', num: 5 }),
    });
    const json = await res.json();
    if (!json.organic) return '';
    return json.organic.slice(0, 5).map(r => `[${r.title}] ${r.snippet ?? ''}`).join('\n');
  } catch (_) {
    return '';
  }
}

// ─── Claude API ───────────────────────────────────────────────────────────────
async function askClaude(ytData, hasAd, searchSnippets, ottSnippets, claudeKey) {
  const fmt = list =>
    list.length > 0
      ? list.map((c, i) => `${i + 1}. [likes: ${c.likes}] ${c.text}`).join('\n')
      : 'none';

  const adText = hasAd === null ? 'unknown' : hasAd ? 'yes' : 'no';

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

[Comments containing "결말" (ending) — up to 50, sorted by likes — primary signal]
${fmt(ytData.endingComments)}
${ytData.topComments.length > 0 ? `\n[Top comments (supplementary)]\n${fmt(ytData.topComments)}` : ''}

[Web Search Results — ending/airing]
${searchSnippets || 'No results'}

[OTT Search Results — where to watch]
${ottSnippets || 'No results'}
`.trim();

  const systemPrompt = `You are an expert at analyzing whether a YouTube review video covers the ending of a movie, drama, webtoon, or manga.

Use these criteria to decide:
- If comments complain "no ending", "cut off in the middle", "where's part 2", "cliffhanger" → likely NO ending
- If the title contains words like "ending", "finale", "complete", "final episode", "결말", "완결", "엔딩" → likely HAS ending
- If the title contains "part 1", "review 1", "first half", "1부", "전편" → likely NO ending
- If the work is currently airing/in theaters → ending unlikely to be covered
- If duration is very short (under PT10M) → likely a partial review
- Ads are NOT a reliable signal: they appear due to creator monetization, Content ID claims by studios, or YouTube's own ad system — ignore this field for the verdict
- Note: comments are in Korean. "결말 없음" = no ending, "1부냐" = is this part 1?, "중간에 끊음" = cuts off midway, "2편 언제" = when is part 2

For workTitle, cast, synopsis:
- Only fill these in if the work title is clearly stated in the video title or description
- If the title is only inferrable from comments, require 3 or more comments to mention the same work title before filling in workTitle
- If uncertain, set workTitle/cast/synopsis to null — it is better to return null than to guess incorrectly

For ottPlatforms:
- Only fill in if web search results explicitly mention which OTT/streaming platforms currently carry the work
- Format as a comma-separated list (e.g. "Netflix, Disney+, Wavve")
- Set to null if not found in search results

All output fields (reason, synopsis, cast, workTitle, ottPlatforms) must be in English.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeKey,
      'anthropic-version': '2023-06-01',
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
            verdict:      { type: 'string', enum: ['contains_ending', 'no_ending', 'uncertain'], description: 'Whether the video covers the ending' },
            confidence:   { type: 'string', enum: ['high', 'medium', 'low'], description: 'Confidence level' },
            reason:       { type: 'string', description: 'Reasoning in 1–2 sentences (in English)' },
            workTitle:    { type: ['string', 'null'], description: 'Title of the reviewed work. null if unknown' },
            cast:         { type: ['string', 'null'], description: 'Main cast members. null if unknown' },
            synopsis:     { type: ['string', 'null'], description: '2–3 sentence synopsis (in English). null if unknown' },
            isAiring:     { type: ['boolean', 'null'], description: 'true if currently airing/in theaters, false if finished, null if unknown' },
            ottPlatforms: { type: ['string', 'null'], description: 'Comma-separated streaming platforms (e.g. "Netflix, Wavve"). null if not found.' },
          },
          required: ['verdict', 'confidence', 'reason'],
        },
      }],
      tool_choice: { type: 'tool', name: 'spoiler_result' },
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  const json = await res.json();
  if (json.error) throw new Error(`Claude API error: ${json.error.message}`);
  const toolUse = json.content?.find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('Unexpected Claude response format');
  return toolUse.input;
}

// ─── 메인 테스트 루너 ─────────────────────────────────────────────────────────
async function runTest(tc, index, total) {
  const videoId = extractVideoId(tc.url);
  if (!videoId) return { ...tc, result: null, error: 'Invalid URL', correct: false };

  process.stdout.write(`[${index + 1}/${total}] ${tc.category} | ${tc.url.slice(-20)} ... `);

  try {
    // background.js와 동일한 흐름
    const [ytData] = await Promise.all([
      getYouTubeData(videoId, CONFIG.ytKey),
    ]);

    const [searchSnippets, ottResult] = await Promise.all([
      webSearch(ytData.title, CONFIG.serperKey),
      getOttPlatforms(ytData.title, CONFIG.tmdbKey, CONFIG.serperKey),
    ]);

    const ottSnippets = ottResult.direct ? '' : ottResult.snippets;

    const claudeResult = await askClaude(ytData, null, searchSnippets, ottSnippets, CONFIG.claudeKey);

    // TMDB 직접 결과 주입
    if (ottResult.direct) claudeResult.ottPlatforms = ottResult.direct;

    const exactMatch = claudeResult.verdict === tc.expected;

    console.log(`${exactMatch ? '✅' : '❌'} got=${claudeResult.verdict} (${claudeResult.confidence}) expected=${tc.expected}`);
    console.log(`   └─ ${claudeResult.reason}`);
    if (claudeResult.ottPlatforms) console.log(`   └─ OTT: ${claudeResult.ottPlatforms}`);

    return { ...tc, videoTitle: ytData.title, result: claudeResult, correct: exactMatch };
  } catch (err) {
    console.log(`💥 ERROR: ${err.message}`);
    return { ...tc, result: null, error: err.message, correct: false };
  }
}

function printSummary(results) {
  console.log('\n' + '═'.repeat(70));
  console.log(' ACCURACY REPORT');
  console.log('═'.repeat(70));

  // 카테고리별 집계
  const categories = [...new Set(results.map(r => r.category))];
  for (const cat of categories) {
    const group   = results.filter(r => r.category === cat && !r.error);
    const correct = group.filter(r => r.correct).length;
    const pct     = group.length ? Math.round(correct / group.length * 100) : 0;
    const bar     = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    console.log(`  ${cat.padEnd(18)} ${bar} ${correct}/${group.length} (${pct}%)`);
  }

  console.log('─'.repeat(70));

  const valid   = results.filter(r => !r.error);
  const correct = valid.filter(r => r.correct).length;
  const errors  = results.filter(r => r.error).length;
  const pct     = valid.length ? Math.round(correct / valid.length * 100) : 0;

  console.log(`  ${'전체 정확도'.padEnd(18)} ${correct}/${valid.length} (${pct}%)`);
  if (errors > 0) console.log(`  API 오류: ${errors}건 (제외)`);

  const uncertainCount = valid.filter(r => r.result?.verdict === 'uncertain').length;
  console.log(`  Uncertain 판정: ${uncertainCount}/${valid.length}건`);

  // OTT 결과 통계
  const ottFound = valid.filter(r => r.result?.ottPlatforms).length;
  console.log(`  OTT 정보 수집: ${ottFound}/${valid.length}건`);

  // 오답 목록
  const wrong = valid.filter(r => !r.correct);
  if (wrong.length > 0) {
    console.log('\n오답 목록:');
    wrong.forEach(r => {
      console.log(`  ❌ [${r.category}] ${r.videoTitle ?? r.url}`);
      console.log(`     expected=${r.expected}, got=${r.result?.verdict ?? 'error'} — ${r.result?.reason ?? r.error}`);
    });
  }

  console.log('═'.repeat(70) + '\n');
}

// ─── 진입점 ───────────────────────────────────────────────────────────────────
(async () => {
  if (!CONFIG.claudeKey) { console.error('❌ CLAUDE_KEY not set'); process.exit(1); }
  if (!CONFIG.ytKey)     { console.error('❌ YT_KEY not set');     process.exit(1); }

  const filled = TEST_CASES.filter(tc => tc.url.trim() !== '');
  if (filled.length === 0) {
    console.error('❌ TEST_CASES에 URL이 하나도 없습니다. 파일을 열어 url 항목을 채워주세요.');
    process.exit(1);
  }

  const ottMode = CONFIG.tmdbKey ? 'TMDB → Serper fallback' : CONFIG.serperKey ? 'Serper only' : 'none';
  console.log(`\n🎬 Spoiler AI Accuracy Test — ${filled.length}개 영상`);
  console.log(`   OTT 모드: ${ottMode}\n`);

  const results = [];
  for (let i = 0; i < filled.length; i++) {
    const result = await runTest(filled[i], i, filled.length);
    results.push(result);
    if (i < filled.length - 1) await sleep(1000); // API rate limit 방지
  }

  printSummary(results);
})();
