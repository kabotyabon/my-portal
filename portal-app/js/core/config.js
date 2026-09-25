// =====================
// ペルソナ（複数管理・2026-09-25〜）
// =====================
// 各パック一式（card.json / scene.json / avatar.png / expressions/）は
// portal-app/assets/personas/<slug>/ に置く。一覧は同階層の index.json
// （[{slug, name}, ...]）が持つ（静的サイトはディレクトリ一覧を取得できないため）。
// 公開面に出るので、著作物に依拠しないオリジナルのペルソナのみを配置すること。
//
// 選択中の slug は localStorage（ACTIVE_PERSONA_KEY）に保持する。
// 切替は設定画面のペルソナ選択 → 保存 → location.reload() で行う
// （PERSONA_DIR は起動時に1回だけ決まる定数のため、切替後は再読み込みが要る）。
const PERSONAS_BASE = 'assets/personas/';
const ACTIVE_PERSONA_KEY = 'active_persona_slug';
const DEFAULT_PERSONA_SLUG = 'kohaho';

function getActivePersonaSlug() {
  return localStorage.getItem(ACTIVE_PERSONA_KEY) || DEFAULT_PERSONA_SLUG;
}
window.getActivePersonaSlug = getActivePersonaSlug;

function setActivePersonaSlug(slug) {
  localStorage.setItem(ACTIVE_PERSONA_KEY, slug);
}
window.setActivePersonaSlug = setActivePersonaSlug;

/** ペルソナ一覧（index.json）を取得する。設定画面のセレクタ用。 */
async function fetchPersonaList() {
  const res = await fetch(`${PERSONAS_BASE}index.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
window.fetchPersonaList = fetchPersonaList;

// =====================
// デモモード
// =====================
// URL に ?demo を付けて開くと、PAT・Gemini APIキーなしで体験できるデモモードになる。
// AI の返答をペルソナパックの demo.json（台本）に差し替えるだけで、
// 表情タグ・背景タグ・返信候補の解析／描画は本番と同じパイプラインを通す。
// デモ中は GitHub への書き込み・セッション保存を一切行わない（js/domains/demo-script.js）。
// 顔は使用中の選択に関わらず常に「こまる」固定（オーナーが今どのペルソナを使っているかを
// 公開デモで漏らさないため）。
const DEMO_MODE = new URLSearchParams(location.search).has('demo');
window.DEMO_MODE = DEMO_MODE;
const DEMO_PERSONA_SLUG = 'komaru';

const PERSONA_DIR = `${PERSONAS_BASE}${DEMO_MODE ? DEMO_PERSONA_SLUG : getActivePersonaSlug()}/`;
window.PERSONA_DIR = PERSONA_DIR;

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
