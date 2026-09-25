// =====================
// 設定画面: Perxona キーと「キャラクター」欄
// =====================
// キャラクターの見た目は 2D 立ち絵（assets/avatars）と 3D（Perxona カタログ）を1つの一覧で選ぶ。
// 3D の選択肢と音声は Perxona キーがあるときだけ出す。
// select の value は "2d:<slug>" / "3d:<avatar_id>" で、2D/3D の別を値に持たせる。
// Scene ID は静的（PerxonaConfig.DEFAULTS.sceneId。背景は舞台側の scene.json が担う）。

function _perxonaStatus(msg, ok) {
  const el = document.getElementById('perxona-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = ok === undefined ? '' : (ok ? 'var(--green)' : 'var(--red, #c0392b)');
}

function _escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- Perxona キー（Gemini キーと同じ形の UI） ----
function showModalPerxonaUI() {
  const has = !!PerxonaConfig.getKey();
  document.getElementById('modal-perxona-set')?.classList.toggle('is-hidden', !has);
  document.getElementById('modal-perxona-unset')?.classList.toggle('is-hidden', has);
  document.getElementById('perxona-clear-btn')?.classList.toggle('is-hidden', !has);
  const st = document.getElementById('perxona-test-status');
  if (st) st.textContent = '';
}

function savePerxonaKey() {
  const input = document.getElementById('perxona-key-input');
  const val = (input?.value || '').trim();
  if (!val) return;
  PerxonaConfig.setKey(val);
  input.value = '';
  showModalPerxonaUI();
  initCharacterSettings();   // 3D と音声の選択肢を出す
}

function clearPerxonaKey() {
  PerxonaConfig.setKey('');
  showModalPerxonaUI();
  initCharacterSettings();
  if (typeof AvatarScene !== 'undefined') AvatarScene.remountPerxona();   // 3D 表示中なら 2D へ戻す
}

async function testPerxonaKey() {
  const st = document.getElementById('perxona-test-status');
  const typed = (document.getElementById('perxona-key-input')?.value || '').trim();
  const saved = PerxonaConfig.getKey();
  if (!typed && !saved) { if (st) st.textContent = '❌ キーが入力されていません'; return; }
  if (st) st.textContent = '⏳ テスト中...';
  if (typed) PerxonaConfig.setKey(typed);   // fetchJson は保存済みのキーを使うので一時的に差し替える
  try {
    await PerxonaConfig.fetchJson('/voices?language=ja&page=1&size=1');
    if (st) st.textContent = '✅ 接続成功';
  } catch (e) {
    if (st) st.textContent = `❌ エラー: ${e.message}（Allowed Domains も確認してください）`;
  } finally {
    if (typed) PerxonaConfig.setKey(saved);
  }
}

// ---- キャラクター（見た目＋音声） ----
function _current2dSlug() {
  return getAvatarDir().replace(AVATARS_BASE, '').replace(/\/$/, '');
}

function _currentCharacterValue() {
  return PerxonaConfig.isEnabled() ? `3d:${PerxonaConfig.getAvatarId()}` : `2d:${_current2dSlug()}`;
}

/** 音声欄と音声テストは 3D を選んでいるときだけ出す */
function _syncVoiceVisibility() {
  const is3d = (document.getElementById('avatar-select')?.value || '').startsWith('3d:');
  document.getElementById('voice-field')?.classList.toggle('is-hidden', !is3d);
  document.getElementById('voice-test-btn')?.classList.toggle('is-hidden', !is3d);
}

async function _loadPerxonaVoices() {
  const select = document.getElementById('perxona-voice-select');
  if (!select) return;
  const current = PerxonaConfig.getVoiceId();
  const items = await PerxonaConfig.fetchAll('/voices?language=ja');
  select.innerHTML = '<option value="">なし（無音）</option>' + items.map(v =>
    `<option value="${_escAttr(v.id)}">${_escAttr(v.name)}（${_escAttr(v.provider)}）</option>`).join('');
  if (current && !items.some(v => v.id === current)) {
    select.insertAdjacentHTML('beforeend', `<option value="${_escAttr(current)}">${_escAttr(current)}（保存済み）</option>`);
  }
  select.value = current;
}

async function initCharacterSettings() {
  showModalPerxonaUI();
  const select = document.getElementById('avatar-select');
  if (!select) return;
  _perxonaStatus('');

  let html = '';
  try {
    const list2d = await fetchAvatarList();
    html += list2d.map(a => `<option value="2d:${_escAttr(a.slug)}">${_escAttr(a.name)}（2D）</option>`).join('');
  } catch (e) {
    console.warn('見た目一覧の取得に失敗しました:', e);
  }

  if (PerxonaConfig.getKey()) {
    try {
      const list3d = await PerxonaConfig.fetchAll('/assets/avatars');
      const current = PerxonaConfig.getAvatarId();
      html += list3d.map(a => `<option value="3d:${_escAttr(a.avatar_id)}">${_escAttr(a.name)}（3D）</option>`).join('');
      if (current && !list3d.some(a => a.avatar_id === current)) {
        html += `<option value="3d:${_escAttr(current)}">${_escAttr(current)}（3D・保存済み）</option>`;
      }
      await _loadPerxonaVoices();
    } catch (e) {
      _perxonaStatus(`3D の一覧を取得できません（${e.message}）。Perxona キーの接続テストで確認してください`, false);
    }
  }

  select.innerHTML = html;
  select.value = _currentCharacterValue();
  if (!select.value && select.options.length) select.selectedIndex = 0;
  select.onchange = _syncVoiceVisibility;
  _syncVoiceVisibility();
}

function switchCharacter() {
  const value = document.getElementById('avatar-select')?.value || '';
  const [kind, id] = [value.slice(0, 2), value.slice(3)];
  if (!id) return;
  if (kind === '3d') {
    PerxonaConfig.setAvatarId(id);
    PerxonaConfig.setVoiceId(document.getElementById('perxona-voice-select')?.value || '');
    PerxonaConfig.setEnabled(true);
  } else {
    // 人格の既定と同じ見た目なら上書きを消し、card.json の defaultAvatar に従わせる
    const def = (window.AI_PERSONA && window.AI_PERSONA.defaultAvatar) || DEFAULT_AVATAR_SLUG;
    setAvatarOverride(id === def ? '' : id);
    PerxonaConfig.setEnabled(false);
  }
  location.reload();
}

/**
 * 音声テスト。クリック操作の中で再生のロックを解除してから発話させるので、
 * 「会話では鳴らないがここでは鳴る」なら会話側の解除タイミング、
 * 「ここでも鳴らない」なら音声・Key・端末側の問題、と切り分けられる。
 */
async function testPerxonaVoice() {
  if (!PerxonaConfig.isEnabled()) {
    _perxonaStatus('3D の見た目に切り替えてから試してください', false);
    return;
  }
  if (typeof PerxonaStage === 'undefined' || !PerxonaStage.isReady) {
    _perxonaStatus('3D アバターがまだ準備中です。対話画面で表示されてから試してください', false);
    return;
  }
  const voice = PerxonaConfig.getVoiceId();
  if (!voice) { _perxonaStatus('音声が「なし」になっています。音声を選んで切り替えてください', false); return; }

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

// 初期化に失敗したら設定画面に理由を出す（AvatarScene が 2D へ戻したあと）
document.addEventListener('perxona-failed', (e) => {
  _perxonaStatus(`3D の初期化に失敗したため 2D で表示しています（${e.detail.reason}）。Perxona キーの接続テストで確認してください`, false);
});

window.savePerxonaKey = savePerxonaKey;
window.clearPerxonaKey = clearPerxonaKey;
window.testPerxonaKey = testPerxonaKey;
window.testPerxonaVoice = testPerxonaVoice;
window.switchCharacter = switchCharacter;
window.initCharacterSettings = initCharacterSettings;
initCharacterSettings();
