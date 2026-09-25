// =====================
// 設定画面: Perxona（3D アバター・音声）
// =====================

function _perxonaStatus(msg, ok) {
  const el = document.getElementById('perxona-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = ok === undefined ? '' : (ok ? 'var(--green)' : 'var(--red, #c0392b)');
}

function _escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 日本語対応の音声一覧を Connect API から取得して select に反映する */
async function loadPerxonaVoices() {
  const select = document.getElementById('perxona-voice-select');
  if (!select || !PerxonaConfig.getKey()) return;
  const current = PerxonaConfig.getVoiceId();
  try {
    const items = await PerxonaConfig.fetchAll('/voices?language=ja');
    select.innerHTML = '<option value="">なし（無音）</option>' + items.map(v =>
      `<option value="${_escAttr(v.id)}">${_escAttr(v.name)}（${_escAttr(v.provider)}）</option>`).join('');
    if (current && !items.some(v => v.id === current)) {
      select.insertAdjacentHTML('beforeend', `<option value="${_escAttr(current)}">${_escAttr(current)}（保存済み）</option>`);
    }
    select.value = current;
  } catch (e) {
    _perxonaStatus(`音声一覧を取得できません（${e.message}）。Key と Allowed Domains を確認してください`, false);
  }
}

/** アバター一覧を Connect API（/assets/avatars）から取得して select に反映する */
async function loadPerxonaAvatars() {
  const select = document.getElementById('perxona-avatar-select');
  if (!select || !PerxonaConfig.getKey()) return;
  const current = PerxonaConfig.getAvatarId();
  try {
    const items = await PerxonaConfig.fetchAll('/assets/avatars');
    select.innerHTML = items.map(a =>
      `<option value="${_escAttr(a.avatar_id)}">${_escAttr(a.name)}</option>`).join('');
    if (current && !items.some(a => a.avatar_id === current)) {
      select.insertAdjacentHTML('beforeend', `<option value="${_escAttr(current)}">${_escAttr(current)}（保存済み）</option>`);
    }
    select.value = current;
  } catch (e) {
    _perxonaStatus(`アバター一覧を取得できません（${e.message}）。Key と Allowed Domains を確認してください`, false);
  }
}

function initPerxonaSettings() {
  const key = document.getElementById('perxona-key-input');
  if (!key) return;
  key.value = PerxonaConfig.getKey();
  document.getElementById('perxona-scene-input').value = PerxonaConfig.getSceneId();
  document.getElementById('perxona-enabled').checked = localStorage.getItem(PERXONA_KEYS.ENABLED) !== '0';
  loadPerxonaVoices();
  loadPerxonaAvatars();
}

function savePerxonaSettings() {
  PerxonaConfig.setKey(document.getElementById('perxona-key-input').value);
  PerxonaConfig.setAvatarId(document.getElementById('perxona-avatar-select').value);
  PerxonaConfig.setSceneId(document.getElementById('perxona-scene-input').value);
  PerxonaConfig.setVoiceId(document.getElementById('perxona-voice-select').value);
  PerxonaConfig.setEnabled(document.getElementById('perxona-enabled').checked);

  if (!PerxonaConfig.getKey()) {
    _perxonaStatus('Publishable Key が未設定のため、2D 立ち絵で表示します', false);
  } else if (!PerxonaConfig.isEnabled()) {
    _perxonaStatus('保存しました（2D 立ち絵で表示します）', true);
  } else {
    _perxonaStatus('保存しました。対話画面で 3D アバターを読み込みます', true);
  }
  if (typeof AvatarScene !== 'undefined') AvatarScene.remountPerxona();
  loadPerxonaVoices();
  loadPerxonaAvatars();
}

/**
 * 音声テスト。クリック操作の中で再生のロックを解除してから発話させるので、
 * 「会話では鳴らないがここでは鳴る」なら会話側の解除タイミング、
 * 「ここでも鳴らない」なら音声・Key・端末側の問題、と切り分けられる。
 */
async function testPerxonaVoice() {
  if (!PerxonaConfig.isEnabled()) {
    _perxonaStatus('3D アバターがオフ、または Key 未設定です。保存して反映してから試してください', false);
    return;
  }
  if (typeof PerxonaStage === 'undefined' || !PerxonaStage.isReady) {
    _perxonaStatus('3D アバターがまだ準備中です。対話画面で表示されてから試してください', false);
    return;
  }
  const voice = PerxonaConfig.getVoiceId();
  if (!voice) { _perxonaStatus('音声が「なし」になっています。音声を選んで保存してください', false); return; }

  _perxonaStatus('発話中…（音が出るか確認してください）');
  PerxonaStage.unlockAudio();
  const ok = await PerxonaStage.present('こんにちは、音声のテストです。聞こえていますか？');
  if (ok) {
    _perxonaStatus('発話を送信しました。音が出なければ、端末の音量・ミュート・ブラウザのタブ消音を確認してください', true);
  } else {
    const r = PerxonaStage.lastResult || {};
    _perxonaStatus(`発話に失敗しました（code: ${r.code ?? '-'} / ${r.message ?? '不明'}）`, false);
  }
}
window.testPerxonaVoice = testPerxonaVoice;

// 初期化に失敗したら設定画面に理由を出す（AvatarScene が 2D へ戻したあと）
document.addEventListener('perxona-failed', (e) => {
  _perxonaStatus(`3D の初期化に失敗したため 2D で表示しています（${e.detail.reason}）。Key・Allowed Domains・Avatar / Scene ID を確認してください`, false);
});

window.savePerxonaSettings = savePerxonaSettings;
window.initPerxonaSettings = initPerxonaSettings;
initPerxonaSettings();
