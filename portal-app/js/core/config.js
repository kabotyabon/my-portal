// =====================
// 人格・表示の分離（2026-09-25〜）
// =====================
// 人格（card.json）は個人に属するので非公開の vault に置き、中間サーバー経由で読む。
// 人格は vault につき1つ（選ぶものではなく、その vault の持ち主の相棒）:
//   vault/persona/card.json           … 人格の定義（defaultAvatar で既定の見た目を指す）
// 表示（立ち絵・表情差分・scene.json）は誰が使っても同じ素材なのでアプリ側（公開）に置く:
//   assets/avatars/index.json         … [{slug, name}, ...]
//   assets/avatars/<slug>/scene.json  … 表情・背景の定義と画像一式
// 公開面に出るので、著作物に依拠しないオリジナルの素材のみを配置すること。
//
// 見た目の選択は localStorage（ACTIVE_AVATAR_KEY）。空なら人格の defaultAvatar に従う。
// 切替は設定画面 → location.reload()。
const PERSONA_CARD_PATH = 'vault/persona/card.json';
const AVATARS_BASE = 'assets/avatars/';
const ACTIVE_AVATAR_KEY = 'active_avatar_slug';
const DEFAULT_AVATAR_SLUG = 'kohaho';

/** 見た目の上書き指定（空文字 = 人格の defaultAvatar に従う） */
function getAvatarOverride() {
  return localStorage.getItem(ACTIVE_AVATAR_KEY) || '';
}
window.getAvatarOverride = getAvatarOverride;

function setAvatarOverride(slug) {
  if (slug) localStorage.setItem(ACTIVE_AVATAR_KEY, slug);
  else localStorage.removeItem(ACTIVE_AVATAR_KEY);
}
window.setAvatarOverride = setAvatarOverride;

/** 実際に使う見た目のディレクトリ（上書き ＞ 人格の defaultAvatar ＞ 既定） */
function getAvatarDir() {
  const slug = getAvatarOverride()
    || (window.AI_PERSONA && window.AI_PERSONA.defaultAvatar)
    || DEFAULT_AVATAR_SLUG;
  return `${AVATARS_BASE}${slug}/`;
}
window.getAvatarDir = getAvatarDir;

/** この vault の人格（card.json）。無ければ null */
async function fetchPersonaCard() {
  const f = await GitHubStorage.getFile(PERSONA_CARD_PATH);
  return f ? JSON.parse(f.content) : null;
}
window.fetchPersonaCard = fetchPersonaCard;

/** 見た目一覧（公開の index.json） */
async function fetchAvatarList() {
  const res = await fetch(`${AVATARS_BASE}index.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
window.fetchAvatarList = fetchAvatarList;

// =====================
// 日付初期化（JST）
// =====================
function getJstTodayISO() {
  const jst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  return `${jst.getFullYear()}-${String(jst.getMonth() + 1).padStart(2, '0')}-${String(jst.getDate()).padStart(2, '0')}`;
}
window.getJstTodayISO = getJstTodayISO;

// ISO日付を n 日ずらす（UTC基準で計算しタイムゾーンの影響を受けないようにする）
function shiftIsoDate(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
window.shiftIsoDate = shiftIsoDate;

/**
 * AI へ渡す「現在日時」ブロックを生成する。
 * LLM は時計を持たず日付を推測してしまうため、プロンプト送信のたびに
 * 呼び出して最新の JST を注入する（ページを開きっぱなしでも日付が腐らない）。
 */
function getJstNowContext() {
  const now     = new Date();
  const todayIso = getJstTodayISO();
  const weekday = now.toLocaleDateString('ja-JP', { weekday: 'long', timeZone: 'Asia/Tokyo' });
  const time    = now.toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo'
  });

  return `## 現在日時（システムが取得した正確な値）
- 今日: ${todayIso}（${weekday}）
- 現在時刻: ${time}（JST / Asia/Tokyo）
- 昨日: ${shiftIsoDate(todayIso, -1)} / 明日: ${shiftIsoDate(todayIso, 1)}

### 日付の絶対ルール
- 「今日」「本日」「今」は必ず上記の値を指します。
- 日付を推測・計算し直さないでください。学習データ上の日付は使わないでください。
- 日記・ファイル名・記録の日付は、上記の値をそのまま使ってください。
- 「今日の日記が無い」と判断する前に、必ず ${todayIso} のファイルを確認してください。`;
}
window.getJstNowContext = getJstNowContext;

// --- 削除済み機能（2026-08-19: チェックリスト・背景の永続化）が残した localStorage キーの掃除 ---
Object.keys(localStorage)
  .filter(k => k.startsWith('checklist_') || k.startsWith('daily-task-')
            || k === 'daily-checklist-date' || k === 'avatar_background')
  .forEach(k => localStorage.removeItem(k));

// --- 中間サーバー移行（2026-09-25）が残した生PATの掃除 ---
// gh_pat・github_pat_token は以前ブラウザから直接GitHubを叩くために使っていた生PAT。
// 今はアクセスキー（portal_api_key）経由で中間サーバーを叩くだけになり不要かつ危険なので破棄する。
['gh_pat', 'github_pat_token'].forEach(k => localStorage.removeItem(k));

// --- 人格の選択（2026-09-25 の一時期だけ存在。人格は vault につき1つになった）の掃除 ---
localStorage.removeItem('active_persona_slug');
