// background.js — Service Worker
// 모든 API 호출은 백엔드 프록시를 통해 실행 (API 키 보안)

const BACKEND = 'https://am-i-spoiler.vercel.app';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'ANALYZE') {
    const tabId = sender.tab.id;
    handleAnalyze(request.videoId, request.videoUrl, tabId)
      .then(result => sendResponse({ ok: true, data: result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

function sendProgress(tabId, videoId, message) {
  chrome.tabs.sendMessage(tabId, { type: 'PROGRESS', videoId, message }).catch(() => {});
}


// ─── 메인 분석 함수 ───────────────────────────────────────────────────────────

async function handleAnalyze(videoId, videoUrl, tabId) {
  console.group(`[Spoiler AI] ${videoId}`);

  // 1. YouTube data + ad signal
  sendProgress(tabId, videoId, 'Fetching video info...');
  const ytRes = await post(`${BACKEND}/api/youtube`, { videoId, videoUrl });
  if (!ytRes.ok) throw new Error(ytRes.error);
  const { ytData, hasAd } = ytRes.data;

  // 언어 감지
  const lang = detectLang(ytData);
  const outputLang = lang;

  console.log('[1] YouTube data', { title: ytData.title, lang, outputLang, hasAd });

  // 2. Web search
  sendProgress(tabId, videoId, 'Searching the web...');
  const searchRes = await post(`${BACKEND}/api/search`, { title: ytData.title, lang });
  const searchSnippets = searchRes.data || '';
  console.log('[2] Search snippets:\n', searchSnippets);

  // 3. Claude 분석 → workTitle 추출
  sendProgress(tabId, videoId, 'thinking...');
  const endingComments = lang === 'ko' ? ytData.koEndingComments : ytData.enEndingComments;
  const ytDataForClaude = { ...ytData, endingComments };
  const claudeRes = await post(`${BACKEND}/api/claude`, { ytData: ytDataForClaude, hasAd, searchSnippets, lang, outputLang });
  if (!claudeRes.ok) throw new Error(claudeRes.error);
  const result = claudeRes.data;
  console.log('[3] Claude output:', result);

  // 4. workTitle로 OTT 조회
  const searchTitle = result.workTitle || ytData.title;
  const ottRes = await post(`${BACKEND}/api/ott`, { title: searchTitle, lang });
  if (ottRes.data) {
    result.ottPlatforms = ottRes.data;
    console.log('[4] OTT:', result.ottPlatforms);
  }

  console.groupEnd();
  return { ...result, hasAd };
}


// ─── 언어 감지 ────────────────────────────────────────────────────────────────

function detectLang(ytData) {
  const lang = ytData.defaultLanguage || '';
  if (lang.startsWith('ko')) return 'ko';
  if (lang && !lang.startsWith('ko')) return 'en';
  return /[\uAC00-\uD7AF]/.test(ytData.title) ? 'ko' : 'en';
}


// ─── 유틸 ─────────────────────────────────────────────────────────────────────

async function post(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
