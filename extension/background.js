// background.js — Service Worker
// 모든 API 호출은 백엔드 프록시를 통해 실행 (API 키 보안)

const BACKEND = 'https://am-i-spoiler.vercel.app';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'ANALYZE') {
    const tabId = sender.tab.id;
    handleAnalyze(request.videoId, tabId)
      .then(result => sendResponse({ ok: true, data: result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

function sendProgress(tabId, videoId, message) {
  chrome.tabs.sendMessage(tabId, { type: 'PROGRESS', videoId, message }).catch(() => {});
}


// ─── 메인 분석 함수 ───────────────────────────────────────────────────────────

async function handleAnalyze(videoId, tabId) {
  console.group(`[Spoiler AI] ${videoId}`);

  // 1. YouTube data
  sendProgress(tabId, videoId, 'Fetching video info...');
  const ytRes = await post(`${BACKEND}/api/youtube`, { videoId });
  if (!ytRes.ok) throw new Error(ytRes.error);
  const { ytData } = ytRes.data;

  const lang = detectLang(ytData);
  const outputLang = lang;
  console.log('[1] YouTube data', { title: ytData.title, lang, hasAd });

  // 2. Claude 1패스 (경량) → workTitle 추출
  sendProgress(tabId, videoId, 'Identifying work...');
  const titleRes = await post(`${BACKEND}/api/extract-title`, {
    title: ytData.title,
    description: ytData.description,
  });
  const workTitle = titleRes.data || null;
  console.log('[2] workTitle:', workTitle);

  // 3. Serper(workTitle 기반) + OTT(workTitle 기반) 병렬
  sendProgress(tabId, videoId, 'Searching the web...');
  const searchKey = workTitle || ytData.title;
  const [searchRes, ottRes] = await Promise.all([
    post(`${BACKEND}/api/search`, { workTitle: searchKey, lang }),
    post(`${BACKEND}/api/ott`,    { title: searchKey, lang }),
  ]);
  const searchSnippets = searchRes.data || '';
  console.log('[3] Search snippets:\n', searchSnippets);
  console.log('[3] OTT:', ottRes.data);

  // 4. Claude 2패스 (풀 분석) — workTitle + Serper 결과 포함
  sendProgress(tabId, videoId, 'thinking...');
  const endingComments = lang === 'ko' ? ytData.koEndingComments : ytData.enEndingComments;
  const ytDataForClaude = { ...ytData, endingComments };
  const claudeRes = await post(`${BACKEND}/api/claude`, {
    ytData: ytDataForClaude, searchSnippets, workTitle, lang, outputLang,
  });
  if (!claudeRes.ok) throw new Error(claudeRes.error);
  const result = { ...claudeRes.data, workTitle };
  console.log('[4] Claude output:', result);

  if (ottRes.data) result.ottPlatforms = ottRes.data;

  console.groupEnd();
  return result;
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
