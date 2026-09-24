// =====================
// 設定画面・永続化ロジック
// =====================

const TOKEN_KEY  = 'portal_api_key'; // 中間サーバー（Worker）のPORTAL_API_KEYと同じ値。GitHub PATはブラウザに持たない
const GEMINI_KEY = 'gemini_api_key';

window.TOKEN_KEY  = TOKEN_KEY;
window.GEMINI_KEY = GEMINI_KEY;

// ---- 基本取得関数 ----
// パスフレーズ暗号化（SecureStore）は 2026-08-08 に廃止した。
// 起動のたびに解錠を求める運用が続かないため、改善ではなく機能ごと外している。
// もともと XSS への防御にはなっておらず、守れていたのは「端末放置時に
// ストレージビューアから平文を読まれる」場合だけだった。
function _readKey(name) {
  return localStorage.getItem(name);
}

/**
 * 旧 SecureStore が残した状態を掃除する（実質1回だけ効く）。
 * 暗号文はもう復号できないので捨てる。キーは設定から入れ直してもらう。
 */
(function migrateFromSecureStore() {
  try {
    const wasEncrypted = localStorage.getItem('key_encryption_enabled') === '1';
    const useSession   = localStorage.getItem('key_storage_backend') === 'session';
    ['gh_pat', 'gemini_api_key'].forEach(k => {
      // sessionStorage に置いていた平文は localStorage へ移す
      if (useSession) {
        const v = sessionStorage.getItem(k);
        if (v !== null) { localStorage.setItem(k, v); sessionStorage.removeItem(k); }
      }
      localStorage.removeItem(`${k}_enc`);
      sessionStorage.removeItem(`${k}_enc`);
    });
    localStorage.removeItem('key_encryption_enabled');
    localStorage.removeItem('key_storage_backend');
    if (wasEncrypted) {
      console.warn('APIキーの暗号化を廃止しました。PAT と Gemini キーを設定から入れ直してください。');
    }
  } catch (e) { /* 掃除できなくても動作に影響しない */ }
})();

function getToken()     { return _readKey(TOKEN_KEY); }
function getGeminiKey() { return _readKey(GEMINI_KEY); }

window.getToken     = getToken;
window.getGeminiKey = getGeminiKey;

// ---- AI Persona (PERSONA_DIR の card.json から読む) ----
// window.AI_PERSONA = { name, userCallName, avatarUrl, greeting, avoidWords, intro, sections, postHistory }
// は app.js の初期化時にセット済み。
// avatarUrl は任意。省略時はペルソナディレクトリの avatar.png を使う（セットを持ち運べるようにするため）
function getAiName()   { return (window.AI_PERSONA && window.AI_PERSONA.name)      || 'AI'; }
function getAiAvatar() { return (window.AI_PERSONA && window.AI_PERSONA.avatarUrl)  || `${PERSONA_DIR}avatar.png`; }

/**
 * card.json のセクションを、プロンプトに載せる1本のテキストへ組み立てる。
 * 見出しの順序は card.json の配列順がそのまま効く（順序をデータで持つため）。
 */
function getAiPrompt() {
  const p = window.AI_PERSONA || {};
  const blocks = [];
  if (p.intro) blocks.push(p.intro);
  (p.sections || []).forEach(s => {
    if (!s || !s.heading) return;
    blocks.push(`【${s.heading}】\n${(s.lines || []).join('\n')}`);
  });
  const body = blocks.join('\n\n') || 'あなたは優秀なアシスタントです。';
  // {呼称} と {userCallName} は同義（後者は非日本語ペルソナ向けの表記 / persona-pack-spec §2）
  return body.replace(/\{呼称\}|\{userCallName\}/g, p.userCallName || 'ユーザー');
}

// ---- 初期化 ----
function initSettingsTab() {
  showModalTokenUI();
  showModalGeminiUI();
  renderReplyFeedbackTally();

  const statusEl = document.getElementById('modal-status');
  if (statusEl) statusEl.textContent = '';
}

// ---- 返信候補から拾ったフィードバック ----
function renderReplyFeedbackTally() {
  const el = document.getElementById('reply-feedback-tally');
  if (!el || typeof ReplyFeedback === 'undefined') return;

  const t = ReplyFeedback.tally();
  if (!t.total) {
    el.textContent = 'まだ記録がありません。対話画面で返信候補を押すと溜まります。';
    return;
  }
  // 実装の言葉（vault / ADR / 保存先）は出さない。ユーザーが見て意味の分かるものだけ。
  const violations = ReplyFeedback.recentViolations();
  el.innerHTML = `直近 <strong>${t.total}</strong> 回の反応<br>`
    + `会話を閉じる返信 ${t.close} ／ 掘り下げる返信 ${t.more}<br>`
    + `候補を使わず自分で入力 ${t.free} ／ その他 ${t.other}`
    + (violations.length
        ? `<br><span style="color:#cf222e;">使わない約束の言葉を検出: ${violations.map(escapeHtml).join('・')}</span>`
        : '');
}

function resetReplyFeedback() {
  if (typeof ReplyFeedback === 'undefined') return;
  ReplyFeedback.reset();
  renderReplyFeedbackTally();
}

// 設定画面の「アバターの表情と舞台」UI（背景セレクタ・表情プレビュー）は 2026-08-19 に削除。
// 表情・背景の切り替えは対話中の [表情:]/[背景:] タグ経由でのみ行う（avatar-scene.js）。

/**
 * APIキーとして保存してよい文字列か検査する。
 *
 * キーは HTTP ヘッダ（Authorization / x-goog-api-key）に載せるため、
 * ISO-8859-1 の範囲外の文字が1つでもあると fetch が
 * 「String contains non ISO-8859-1 code point」という TypeError を投げる。
 * これは呼び出し箇所から遠いところで出るので、原因にたどり着けない。
 *
 * 実際に「トークン欄に別のテキストを貼ってしまい、全 API が落ちる」事故が起きたので、
 * 入口で弾いて理由を伝える。
 *
 * @returns {string|null} 問題があればメッセージ、無ければ null
 */
function _validateApiKey(val, label) {
  const bad = [...val].filter(ch => ch.codePointAt(0) > 0x7e || ch.codePointAt(0) < 0x21);
  if (bad.length) {
    const sample = [...new Set(bad)].slice(0, 5)
      .map(ch => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
      .join(' ');
    return `${label}に使えない文字が ${bad.length} 個含まれています（${sample}）。\n`
         + '全角文字や空白が混ざっていないか、貼り付けた内容を確認してください。';
  }
  return null;
}

// ---- アクセスキー（中間サーバーのPORTAL_API_KEY） ----
function showModalTokenUI() {
  const hasToken = !!getToken();
  document.getElementById('modal-pat-set').classList.toggle('is-hidden', !hasToken);
  document.getElementById('modal-pat-unset').classList.toggle('is-hidden', hasToken);
}

async function saveToken() {
  const val = document.getElementById('token-input').value.trim();
  if (!val) return;
  const invalid = _validateApiKey(val, 'アクセスキー');
  if (invalid) { alert(invalid); return; }
  try {
    await _writeKey(TOKEN_KEY, val);
  } catch (e) {
    alert(`保存できませんでした: ${e.message}`);
    return;
  }
  document.getElementById('token-input').value = '';
  showModalTokenUI();
  location.reload(); // トークン変更時は確実な反映のためリロード推奨
}

function clearToken() {
  _removeKey(TOKEN_KEY);
  showModalTokenUI();
  location.reload();
}

// ---- Gemini API Key ----
function showModalGeminiUI() {
  const has = !!getGeminiKey();
  document.getElementById('modal-gemini-set').classList.toggle('is-hidden', !has);
  document.getElementById('modal-gemini-unset').classList.toggle('is-hidden', has);
}

async function saveGeminiKey() {
  const val = document.getElementById('gemini-key-input').value.trim();
  if (!val) return;
  const invalid = _validateApiKey(val, 'Gemini API キー');
  if (invalid) { alert(invalid); return; }
  try {
    await _writeKey(GEMINI_KEY, val);
  } catch (e) {
    alert(`保存できませんでした: ${e.message}`);
    return;
  }
  document.getElementById('gemini-key-input').value = '';
  showModalGeminiUI();
}

function clearGeminiKey() { _removeKey(GEMINI_KEY); showModalGeminiUI(); }

// ---- APIキーの書き込み ----
// 呼び出し側は await している。Promise を返さなくても await は通るのでそのままでよい。
function _writeKey(name, value) { localStorage.setItem(name, value); }
function _removeKey(name)       { localStorage.removeItem(name); }

// ---- Kintai URL ----
function getKintaiUrl() { return ConfigService.data.kintaiUrl || ''; }

async function saveKintaiUrl() {
  const val = document.getElementById('kintai-url-input').value.trim();
  const st = document.getElementById('kintai-url-status');
  st.textContent = '保存中...';
  await ConfigService.updateConfig({ kintaiUrl: val }, '📊 勤怠URLを更新');
  st.style.color = '#1a7f37'; st.textContent = '✅ 保存しました';
  setTimeout(() => { st.textContent = ''; }, 2000);
}

// global 登録
window.getToken = getToken;
window.getGeminiKey = getGeminiKey;
window.getAiName = getAiName;
window.getAiPrompt = getAiPrompt;
window.getAiAvatar = getAiAvatar;
window.getKintaiUrl = getKintaiUrl;
window.initSettingsTab = initSettingsTab;
window.saveToken = saveToken;
window.clearToken = clearToken;
window.saveGeminiKey = saveGeminiKey;
window.clearGeminiKey = clearGeminiKey;
window.saveKintaiUrl = saveKintaiUrl;
window.renderReplyFeedbackTally = renderReplyFeedbackTally;
window.resetReplyFeedback = resetReplyFeedback;
window.testGeminiKey = async function() {
  const key = document.getElementById('gemini-key-input')?.value || getGeminiKey();
  const statusEl = document.getElementById('gemini-test-status');
  if (!key) {
    if (statusEl) statusEl.textContent = '❌ キーが入力されていません';
    return;
  }
  if (statusEl) statusEl.textContent = '⏳ テスト中...';
  try {
    // キーはヘッダーで送る。モデルは gemini.js の定義に合わせる
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${window.GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Hello' }] }] })
    });
    if (res.ok) {
      if (statusEl) statusEl.textContent = '✅ 接続成功';
    } else {
      const err = await res.json().catch(() => ({}));
      if (statusEl) statusEl.textContent = `❌ エラー: ${err.error?.message || res.status}`;
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = `❌ 接続失敗: ${e.message}`;
  }
};
