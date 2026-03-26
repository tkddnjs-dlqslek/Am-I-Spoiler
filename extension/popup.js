// popup.js — API 키 저장/로드 (chrome.storage.local)

const claudeInput = document.getElementById('claudeKey');
const ytInput     = document.getElementById('ytKey');
const braveInput  = document.getElementById('braveKey');
const tmdbInput   = document.getElementById('tmdbKey');
const saveBtn     = document.getElementById('saveBtn');
const status      = document.getElementById('status');

// 저장된 키 로드 (마스킹 표시)
chrome.storage.local.get(['claudeKey', 'ytKey', 'braveKey', 'tmdbKey'], (data) => {
  if (data.claudeKey) claudeInput.placeholder = '●●●● (저장됨)';
  if (data.ytKey)     ytInput.placeholder     = '●●●● (저장됨)';
  if (data.braveKey)  braveInput.placeholder  = '●●●● (저장됨)';
  if (data.tmdbKey)   tmdbInput.placeholder   = '●●●● (저장됨)';
});

// 저장
saveBtn.addEventListener('click', () => {
  const toSave = {};

  const newClaude = claudeInput.value.trim();
  const newYt     = ytInput.value.trim();
  const newBrave  = braveInput.value.trim();
  const newTmdb   = tmdbInput.value.trim();

  if (newClaude) toSave.claudeKey = newClaude;
  if (newYt)     toSave.ytKey     = newYt;
  if (newBrave)  toSave.braveKey  = newBrave;
  if (newTmdb)   toSave.tmdbKey   = newTmdb;

  if (Object.keys(toSave).length === 0) {
    status.style.color = '#856404';
    status.textContent = 'No changes to save.';
    return;
  }

  chrome.storage.local.set(toSave, () => {
    claudeInput.value = '';
    ytInput.value = '';
    braveInput.value = '';

    // placeholder 업데이트
    chrome.storage.local.get(['claudeKey', 'ytKey', 'braveKey', 'tmdbKey'], (data) => {
      if (data.claudeKey) claudeInput.placeholder = '●●●● (저장됨)';
      if (data.ytKey)     ytInput.placeholder     = '●●●● (저장됨)';
      if (data.braveKey)  braveInput.placeholder  = '●●●● (저장됨)';
      if (data.tmdbKey)   tmdbInput.placeholder   = '●●●● (저장됨)';
    });

    status.style.color = '#155724';
    status.textContent = '✔ Saved successfully.';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});
