// app.js — Content Script (유튜브 페이지에 주입)
// API 호출은 하지 않음 — background.js에 메시지로 위임

const styleSheet = document.createElement('style');
styleSheet.textContent = `
  /* ── Spoiler? 버튼 ── */
  .yt-spoiler-btn {
    position: absolute;
    bottom: 10px;
    right: 10px;
    background: #cc0000;
    color: #fff;
    border: none;
    padding: 6px 14px;
    border-radius: 4px;
    font-size: 13px;
    font-family: 'Roboto', sans-serif;
    font-weight: 600;
    letter-spacing: 0.3px;
    cursor: pointer;
    display: none;
    transition: background 0.15s;
    z-index: 10;
  }
  .yt-spoiler-btn:hover { background: #aa0000; }

  /* 카드 hover 시 버튼 표시 — CSS로 처리 (JS 이벤트보다 안정적) */
  ytd-rich-item-renderer:hover .yt-spoiler-btn,
  ytd-grid-video-renderer:hover .yt-spoiler-btn,
  ytd-rich-grid-media:hover .yt-spoiler-btn,
  ytd-video-renderer:hover .yt-spoiler-btn,
  ytd-compact-video-renderer:hover .yt-spoiler-btn,
  ytd-reel-item-renderer:hover .yt-spoiler-btn,
  ytd-playlist-video-renderer:hover .yt-spoiler-btn,
  yt-lockup-view-model:hover .yt-spoiler-btn,
  ytm-shorts-lockup-view-model:hover .yt-spoiler-btn { display: block; }

  /* 쇼츠 선반 — 작은 버튼 */
  ytd-reel-item-renderer .yt-spoiler-btn,
  ytm-shorts-lockup-view-model .yt-spoiler-btn {
    padding: 4px 10px;
    font-size: 11px;
    bottom: 6px;
    right: 6px;
  }
  /* 시청 중 우측 사이드바 — 썸네일 너비(168px) 기준 왼쪽 정렬 */
  ytd-compact-video-renderer .yt-spoiler-btn,
  yt-lockup-view-model .yt-spoiler-btn {
    padding: 4px 8px;
    font-size: 11px;
    bottom: 6px;
    right: auto;
    left: 118px;
  }

  /* 분석 중엔 hover 여부 무관하게 항상 표시 */
  .yt-spoiler-btn[data-analyzing] { display: block !important; }

  /* ── 모달 전체 ── */
  .yt-spoiler-modal {
    position: fixed;
    inset: auto;   /* popover UA의 inset:0 초기화 */
    margin: 0;
    padding: 0;
    border: none;
    width: 288px;
    background: #1f1f1f;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 12px 32px rgba(0,0,0,0.6);
    font-family: 'Roboto', sans-serif;
    color: #e8e8e8;
    word-break: break-word;
  }

  /* ── 닫기 ── */
  .yt-spoiler-close {
    position: absolute;
    top: 10px;
    right: 12px;
    cursor: pointer;
    color: rgba(255,255,255,0.4);
    font-size: 16px;
    line-height: 1;
    transition: color 0.1s;
  }
  .yt-spoiler-close:hover { color: #fff; }

  /* ── 판정 헤더 (색상 배경) ── */
  .yt-verdict-header {
    padding: 14px 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .yt-verdict-header.yes { background: #1a3328; }
  .yt-verdict-header.no  { background: #2e1515; }
  .yt-verdict-header.idk { background: #2b2410; }

  .yt-verdict-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .yt-verdict-icon {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }
  .yt-verdict-label {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.1px;
  }
  .yes .yt-verdict-label { color: #4caf82; }
  .no  .yt-verdict-label { color: #f4645f; }
  .idk .yt-verdict-label { color: #f5b731; }

  .yt-verdict-confidence {
    margin-left: auto;
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 10px;
    font-weight: 500;
  }
  .yes .yt-verdict-confidence { background: rgba(76,175,130,0.2); color: #4caf82; }
  .no  .yt-verdict-confidence { background: rgba(244,100, 95,0.2); color: #f4645f; }
  .idk .yt-verdict-confidence { background: rgba(245,183, 49,0.2); color: #f5b731; }

  .yt-verdict-reason {
    font-size: 12px;
    color: rgba(255,255,255,0.55);
    line-height: 1.5;
    padding-left: 28px;
  }

  /* ── 메타 섹션 (광고·방영) ── */
  .yt-meta-section {
    padding: 10px 16px;
    border-top: 1px solid #2e2e2e;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .yt-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border-radius: 12px;
    background: #2a2a2a;
    font-size: 11px;
    color: #aaa;
    border: 1px solid #333;
  }
  .yt-pill svg { opacity: 0.7; }

  /* ── 작품 정보 섹션 ── */
  .yt-work-section {
    padding: 12px 16px;
    border-top: 1px solid #2e2e2e;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .yt-work-title {
    font-size: 14px;
    font-weight: 600;
    color: #f1f1f1;
    line-height: 1.3;
  }
  .yt-work-cast {
    font-size: 11px;
    color: #888;
  }
  .yt-work-synopsis {
    font-size: 12px;
    color: #c0c0c0;
    line-height: 1.6;
    margin-top: 2px;
    padding-top: 6px;
    border-top: 1px solid #2e2e2e;
  }

  /* ── 로딩 / 에러 ── */
  .yt-status-section {
    padding: 14px 16px;
    font-size: 12px;
    color: #888;
  }
`;
document.head.appendChild(styleSheet);


// ─── 버튼 생성 ────────────────────────────────────────────────────────────────

// videoId → 분석 중인 버튼 매핑
const analyzingBtns = new Map();

// background.js에서 진행 상황 수신
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'PROGRESS') {
    const btn = analyzingBtns.get(request.videoId);
    if (btn) btn.textContent = request.message;
  }
});

function startProgressAnimation(btn, videoId) {
  btn.dataset.analyzing = '1';
  btn.style.display = 'block';
  btn.style.background = '#333';
  btn.style.cursor = 'default';
  btn.textContent = 'Analyzing...';
  analyzingBtns.set(videoId, btn);
}

function stopProgressAnimation(btn, videoId) {
  delete btn.dataset.analyzing;
  btn.style.display  = '';   // startProgressAnimation에서 고정한 display 해제
  btn.style.background = '';
  btn.style.cursor = '';
  btn.textContent = 'Spoiler?';
  analyzingBtns.delete(videoId);
}

function createSpoilerButton(videoCard) {
  const btn = document.createElement('button');
  btn.className = 'yt-spoiler-btn';
  btn.textContent = 'Spoiler?';

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (btn.dataset.analyzing) return;

    // 기존 모달 닫기
    document.querySelector('.yt-spoiler-modal')?.remove();

    // 앵커 탐색 (여러 fallback)
    const anchor = videoCard.querySelector('a#thumbnail')
      || videoCard.querySelector('ytd-thumbnail a[href]')
      || videoCard.querySelector('a[href*="watch?v="]')
      || videoCard.querySelector('a[href*="/shorts/"]');

    if (!anchor) return;
    const rawHref = anchor.getAttribute('href') || anchor.href;
    if (!rawHref) return;

    const videoId = extractVideoId(rawHref);
    if (!videoId) return;

    const videoUrl = new URL(rawHref, 'https://www.youtube.com').href;

    startProgressAnimation(btn, videoId);

    chrome.runtime.sendMessage(
      { type: 'ANALYZE', videoId, videoUrl },
      (response) => {
        stopProgressAnimation(btn, videoId);

        if (chrome.runtime.lastError || !response) {
          const msg = chrome.runtime.lastError?.message ?? 'No response';
          showErrorModal(videoCard, 'Extension error: ' + msg);
          return;
        }
        if (!response.ok) {
          showErrorModal(videoCard, response.error);
          return;
        }
        showResultModal(videoCard, response.data);
      }
    );
  });

  return btn;
}


// ─── 버튼 주입 ────────────────────────────────────────────────────────────────

// 지원하는 유튜브 카드 타입
const CARD_TYPES = [
  'ytd-rich-item-renderer',                         // 홈 + 채널 동영상 탭
  'ytd-grid-video-renderer',                        // 채널 동영상 탭 (구형 레이아웃)
  'ytd-video-renderer',                             // 검색결과
  'ytd-compact-video-renderer',                     // 영상 시청 중 우측 추천 영상 (구형)
  'yt-lockup-view-model',                           // 영상 시청 중 우측 추천 영상 (신형)
  'ytd-reel-item-renderer',                         // 홈 쇼츠 선반
  'ytd-playlist-video-renderer',                    // 나중에 볼 동영상 / 재생목록
  'ytm-shorts-lockup-view-model',                   // 쇼츠 (검색결과 + 사이드바)
];

// 카드 타입별 버튼 붙일 컨테이너
function getCardContainer(card) {
  const tag = card.tagName.toLowerCase();
  if (
    tag === 'ytd-video-renderer' ||
    tag === 'ytd-compact-video-renderer' ||
    tag === 'ytd-grid-video-renderer' ||
    tag === 'ytd-playlist-video-renderer'
  ) {
    return card.querySelector('#dismissible') || card;
  }
  if (tag === 'ytd-reel-item-renderer') {
    return card;
  }
  if (tag === 'yt-lockup-view-model') {
    // 신형 사이드바 카드: 내부 div.yt-lockup-view-model이 실제 레이아웃 컨테이너
    return card.querySelector('div.yt-lockup-view-model') || card;
  }
  if (tag === 'ytm-shorts-lockup-view-model') {
    return card;
  }
  if (tag === 'ytd-rich-item-renderer') {
    return card.querySelector('#content') || card.querySelector('#dismissible') || card;
  }
  return card.querySelector('#dismissible') || card;
}

// 카드 한 개에 버튼 주입
function injectButtonIntoCard(card) {
  if (card.querySelector('.yt-spoiler-btn')) return;

  // yt-lockup-view-model은 watch 페이지 우측 사이드바에서만 허용
  if (card.tagName.toLowerCase() === 'yt-lockup-view-model' &&
      !window.location.pathname.startsWith('/watch')) return;

  const container = getCardContainer(card);
  if (!container) return;

  const btn = createSpoilerButton(card);
  container.style.position = 'relative';
  container.appendChild(btn);
}

// 현재 DOM의 모든 카드에 일괄 주입 (초기 로드용)
function injectSpoilerButtons() {
  document.querySelectorAll(CARD_SELECTOR).forEach(injectButtonIntoCard);
}


// ─── 모달 렌더링 ──────────────────────────────────────────────────────────────

// ── SVG 아이콘 모음 ──────────────────────────────────────────────────────────
const ICONS = {
  check: `<svg class="yt-verdict-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="10" cy="10" r="9" stroke="#4caf82" stroke-width="1.5"/>
    <path d="M6 10l3 3 5-5" stroke="#4caf82" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  cross: `<svg class="yt-verdict-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="10" cy="10" r="9" stroke="#f4645f" stroke-width="1.5"/>
    <path d="M7 7l6 6M13 7l-6 6" stroke="#f4645f" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,
  question: `<svg class="yt-verdict-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="10" cy="10" r="9" stroke="#f5b731" stroke-width="1.5"/>
    <path d="M8 8c0-1.1.9-2 2-2s2 .9 2 2c0 1-.6 1.5-1.3 2C10 10.5 10 11 10 11.5" stroke="#f5b731" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="10" cy="13.5" r="0.8" fill="#f5b731"/>
  </svg>`,
  ad: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="3" width="12" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
    <path d="M4 9V5.5L7 9V5.5M9 5.5h1.5a1 1 0 010 2H9v1.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  tv: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="2.5" width="12" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
    <path d="M5 11.5h4M7 10.5v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`,
};

const MODAL_W = 288;

// 카드 기준으로 모달 위치를 계산해 style에 적용
function applyModalPosition(modal, card) {
  if (!card || !document.contains(card)) return;
  const r = card.getBoundingClientRect();
  let top  = r.bottom + 8;
  let left = r.left;
  if (left + MODAL_W + 8 > window.innerWidth) left = Math.max(4, window.innerWidth - MODAL_W - 8);
  if (top + 120 > window.innerHeight) top = Math.max(4, r.top - 8 - 200);
  modal.style.top  = top  + 'px';
  modal.style.left = left + 'px';
}

function makeModal(card) {
  // 기존 모달 제거
  document.querySelector('.yt-spoiler-modal')?.remove();

  const modal = document.createElement('div');
  modal.className = 'yt-spoiler-modal';
  modal.style.zIndex = '2147483647';

  const close = document.createElement('span');
  close.className = 'yt-spoiler-close';
  close.textContent = '✕';
  modal.appendChild(close);

  // 초기 위치 설정 후 DOM에 추가
  applyModalPosition(modal, card);
  document.body.appendChild(modal);

  // 스크롤 시 카드 위치를 재계산해 modal을 항상 썸네일 바로 아래에 고정
  const onScroll = () => applyModalPosition(modal, card);
  const ytdApp = document.querySelector('ytd-app');
  if (ytdApp) ytdApp.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });

  // 모달 닫기 + 리스너 정리
  const destroy = () => {
    if (ytdApp) ytdApp.removeEventListener('scroll', onScroll);
    window.removeEventListener('scroll', onScroll);
    modal.remove();
  };
  close.addEventListener('click', destroy);

  return modal;
}

function showLoadingModal(card) {
  const modal = makeModal(card);
  modal.innerHTML += `<div class="yt-status-section">Analyzing...</div>`;
  return modal;
}

function showErrorModal(card, msg) {
  const modal = makeModal(card);
  modal.innerHTML += `<div class="yt-status-section" style="color:#f4645f;">${msg}</div>`;
}

function showResultModal(card, data) {
  const modal = makeModal(card);

  // ── 1. 판정 헤더 ──
  const verdictMap = {
    'contains_ending': { icon: ICONS.check,    label: 'Ending Included', cls: 'yes' },
    'no_ending':       { icon: ICONS.cross,    label: 'No Ending',       cls: 'no'  },
    'uncertain':       { icon: ICONS.question, label: 'Uncertain',       cls: 'idk' },
  };
  const v = verdictMap[data.verdict] ?? verdictMap['uncertain'];

  const header = document.createElement('div');
  header.className = `yt-verdict-header ${v.cls}`;
  header.innerHTML = `
    <div class="yt-verdict-top">
      ${v.icon}
      <span class="yt-verdict-label">${v.label}</span>
      <span class="yt-verdict-confidence">Confidence: ${data.confidence ?? '?'}</span>
    </div>
    ${data.reason ? `<div class="yt-verdict-reason">${data.reason}</div>` : ''}
  `;
  modal.appendChild(header);

  // ── 2. Meta info (ads · airing) ──
  const adLabel     = data.hasAd === null ? 'Ads Unknown' : data.hasAd ? 'Has Ads' : 'No Ads';
  const airingLabel = data.isAiring === null ? null : data.isAiring ? 'Airing' : 'Ended';

  const metaSec = document.createElement('div');
  metaSec.className = 'yt-meta-section';
  metaSec.innerHTML = `
    <span class="yt-pill">${ICONS.ad} ${adLabel}</span>
    ${airingLabel ? `<span class="yt-pill">${ICONS.tv} ${airingLabel}</span>` : ''}
  `;
  modal.appendChild(metaSec);

  // ── 2.5. OTT 플랫폼 ──
  if (data.ottPlatforms) {
    const ottSec = document.createElement('div');
    ottSec.className = 'yt-meta-section';
    ottSec.innerHTML = `<span class="yt-pill" style="width:100%;">📺 ${data.ottPlatforms}</span>`;
    modal.appendChild(ottSec);
  }

  // ── 3. 작품 정보 ──
  if (data.workTitle || data.cast || data.synopsis) {
    const workSec = document.createElement('div');
    workSec.className = 'yt-work-section';
    workSec.innerHTML = `
      ${data.workTitle ? `<div class="yt-work-title">${data.workTitle}</div>` : ''}
      ${data.cast      ? `<div class="yt-work-cast">${data.cast}</div>`       : ''}
      ${data.synopsis  ? `<div class="yt-work-synopsis">${data.synopsis}</div>` : ''}
    `;
    modal.appendChild(workSec);
  }
}


// ─── 유틸 ─────────────────────────────────────────────────────────────────────

function extractVideoId(url) {
  try {
    const u = new URL(url, 'https://www.youtube.com');
    // /watch?v=VIDEO_ID
    const v = u.searchParams.get('v');
    if (v) return v;
    // /shorts/VIDEO_ID, /live/VIDEO_ID
    const m = u.pathname.match(/^\/(shorts|live)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[2];
    return null;
  } catch (_) {
    return null;
  }
}


// ─── 초기화 ───────────────────────────────────────────────────────────────────

const CARD_SELECTOR = CARD_TYPES.join(', ');

// ① mouseover: 마우스가 카드에 진입하는 순간 즉시 주입
document.addEventListener('mouseover', (e) => {
  const card = e.target.closest(CARD_SELECTOR);
  if (card) injectButtonIntoCard(card);
});

// ② MutationObserver: 마우스가 정지된 상태에서 YouTube가 카드를 교체할 때 대응
// document.querySelectorAll(':hover')로 현재 커서 아래 카드를 찾아 즉시 재주입
const observer = new MutationObserver(() => {
  document.querySelectorAll(CARD_SELECTOR + ':hover')
    .forEach(injectButtonIntoCard);
});
observer.observe(document.body, { childList: true, subtree: true });

// 모달 외부 클릭 시 닫기 (close 버튼 click → destroy() 호출 → 스크롤 리스너 정리까지)
document.addEventListener('click', (e) => {
  if (!e.target.closest('.yt-spoiler-modal') && !e.target.closest('.yt-spoiler-btn')) {
    document.querySelector('.yt-spoiler-close')?.click();
  }
}, { capture: true });

// 초기 로드
window.addEventListener('load', () => {
  setTimeout(injectSpoilerButtons, 1500);
});
