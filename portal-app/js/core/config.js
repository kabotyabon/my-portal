// =====================
// 定数・リポジトリ設定
// =====================

function getRepo()   { return (window.PORTAL_CONFIG_INLINE && window.PORTAL_CONFIG_INLINE.repo) || ''; }
function getBranch() { return (window.PORTAL_CONFIG_INLINE && window.PORTAL_CONFIG_INLINE.branch) || 'main'; }

window.getRepo = getRepo;
window.getBranch = getBranch;

// =====================
// ペルソナ
// =====================
// 使用中のアバター一式（card.json / scene.json / avatar.png / expressions/）の置き場。
// 静的サイトはディレクトリ一覧を取得できないため、読む場所は 1つに固定する。
//
// vault は private リポジトリへ分離しているため、Pages から相対 fetch できるのは
// この公開リポジトリ内のファイルだけになる。ペルソナ一式は portal-app/assets/persona/ に置く。
// 公開面に出るので、著作物に依拠しないオリジナルのペルソナのみを配置すること。
//
// 切り替えは assets/ 配下のディレクトリをリネームして行う:
//   git mv portal-app/assets/persona portal-app/assets/_persona-old
//   git mv portal-app/assets/_persona-new portal-app/assets/persona
// `_` で始まるディレクトリはパスが一致しないので読まれない
// （例外: デモモードは DEMO_PERSONA_DIR で `_` 配下のパックを明示的に読む）。
// =====================
// デモモード
// =====================
// URL に ?demo を付けて開くと、PAT・Gemini APIキーなしで体験できるデモモードになる。
// AI の返答をペルソナパックの demo.json（台本）に差し替えるだけで、
// 表情タグ・背景タグ・返信候補の解析／描画は本番と同じパイプラインを通す。
// デモ中は GitHub への書き込み・セッション保存を一切行わない（js/domains/demo-script.js）。
const DEMO_MODE = new URLSearchParams(location.search).has('demo');
window.DEMO_MODE = DEMO_MODE;

// デモの顔はこまる。使用中ペルソナ（assets/persona/ = 個人用）とは独立に、
// 公開デモではこのパックを丸ごと使う（立ち絵・card.json・demo.json のすべて）。
const DEMO_PERSONA_DIR = 'assets/_komaru/';

const PERSONA_DIR = DEMO_MODE ? DEMO_PERSONA_DIR : 'assets/persona/';
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
