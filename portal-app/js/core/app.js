/**
 * app.js
 * ナビゲーション / レスポンシブレイアウト / アプリ初期化
 * ─ html-loader.js の loadAllPartials() 完了後に初期化を実行する。
 *
 * IA（Ambient Companion 改修）:
 *   スマホは 4タブ（talk / diary / memo / settings）。ヘッダーは持たない。
 *   舞台（.vn-stage）はどのタブでも「地」として残るため、AI パネルは隠さない。
 *   日記タブは 今日 / 過去（アーカイブ）の2セグメントを内包する。
 *   デイリーチェックリスト「今日の四つ」（today タブ）は 2026-08-19 に機能ごと削除した。
 */

const MOBILE_BREAKPOINT = 768;

/** ナビシートに並ぶ4項目。 */
const MOBILE_TABS = ['talk', 'diary', 'memo', 'settings'];

let mobileTab   = 'talk';
let diarySegment = 'today';   // today | past
let navOpen     = false;

const setHidden = (el, hidden) => { if (el) el.classList.toggle('is-hidden', hidden); };
const byId      = (id) => document.getElementById(id);

// ========== ナビシートの開閉（対話タブのみ意味を持つ） ==========
function setNavOpen(open) {
  navOpen = !!open;
  document.body.classList.toggle('nav-open', navOpen);
}

function toggleNavSheet() { setNavOpen(!navOpen); }

// 画面タイトル（#app-title）とヘッダー日付（#today）の描画はヘッダーの簡素化に伴い廃止。
// 現在地はタブ行／ナビシート、日付は日記タブの日付ラベルが担う。

// ========== 日記タブのセグメント（今日 / 過去） ==========
function switchDiarySegment(seg) {
  diarySegment = ['today', 'past'].includes(seg) ? seg : 'today';

  byId('dseg-today')?.classList.toggle('active', diarySegment === 'today');
  byId('dseg-past')?.classList.toggle('active',  diarySegment === 'past');

  if (window.innerWidth > MOBILE_BREAKPOINT) return;
  applyMobileLayout();
}

// ========== モバイルの表示状態をまとめて反映する ==========
function applyMobileLayout() {
  const section = mobileTab;
  const isDiary = section === 'diary';

  // 舞台（AI パネル）はどのタブでも地として残す
  setHidden(byId('col-main'),        false);
  setHidden(byId('main-panel-ai'),  false);

  // メモ
  setHidden(byId('col-right'),     section !== 'memo');
  setHidden(byId('memo-tab-card'), section !== 'memo');

  // 日記（今日 / 過去）
  setHidden(byId('diary-segments'),       !isDiary);
  setHidden(byId('main-panel-report'),    !(isDiary && diarySegment === 'today'));
  setHidden(byId('main-panel-archive'),   !(isDiary && diarySegment === 'past'));

  // 設定
  setHidden(byId('main-panel-settings'),  section !== 'settings');

  if (isDiary && diarySegment === 'past' && typeof initArchivePanel === 'function') initArchivePanel();
  if (section === 'settings' && typeof initSettingsTab === 'function') initSettingsTab();
  if (section === 'memo'     && typeof loadMemoTab === 'function')     loadMemoTab();
}

// ========== ナビ切り替え（スマホ） ==========
function switchBottomNav(section) {
  if (!MOBILE_TABS.includes(section)) section = 'talk';
  mobileTab = section;

  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === section);
  });

  document.body.dataset.tab = section;

  // 対話タブに入ったらナビシートは自動で畳む
  setNavOpen(false);

  if (window.innerWidth > MOBILE_BREAKPOINT) return; // PC では表示制御を行わない
  applyMobileLayout();
}

// ========== 設定を開く（PC / スマホ共通の入口） ==========
function openSettings() {
  if (window.innerWidth <= MOBILE_BREAKPOINT) switchBottomNav('settings');
  else if (typeof switchMainTab === 'function') switchMainTab('settings');
}

// ========== モバイルサイドメニュー（旧UIの名残・no-op に近い） ==========
function toggleMobileSideMenu() {
  const colRight = byId('col-right');
  if (!colRight || window.innerWidth > MOBILE_BREAKPOINT) return;
  switchBottomNav('memo');
}

function closeMobileSideMenu() {
  const overlay = byId('mobile-side-overlay');
  overlay?.classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (navOpen) { setNavOpen(false); return; }
  closeMobileSideMenu();
});

// ========== レスポンシブレイアウト同期 ==========
let _syncLastIsMobile = null;

function syncResponsiveLayout() {
  const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;

  // 幅方向のブレークポイント変化がなければスキップ
  if (isMobile === _syncLastIsMobile) return;
  _syncLastIsMobile = isMobile;

  if (!byId('col-main')) return;

  if (isMobile) {
    setNavOpen(false);
    switchBottomNav(mobileTab);
    return;
  }

  // デスクトップ: 2カラムを出し、メインパネルはタブ制御へ戻す
  setNavOpen(false);
  setHidden(byId('col-main'),    false);
  setHidden(byId('col-right'),   false);
  setHidden(byId('memo-tab-card'), false);
  setHidden(byId('diary-segments'), true);
  if (typeof loadMemoTab === 'function') loadMemoTab();

  const activeDesktopTab = document.querySelector('.main-tab.active')?.id?.replace('mtab-', '') || 'ai';
  if (typeof switchMainTab === 'function') switchMainTab(activeDesktopTab);
}

window.addEventListener('resize', syncResponsiveLayout);

// ========== ソフトキーボード対応 ==========
/**
 * キーボードが覆っている高さを --kb として流し、入力バー・台詞・ナビを持ち上げる。
 *
 * Android Chrome は index.html の interactive-widget=resizes-content で
 * レイアウトビューポート自体が縮むため、ここでの overlap はほぼ 0 になる。
 * iOS Safari は interactive-widget に未対応で innerHeight が変わらないため、
 * visualViewport との差分でこちらが効く。二重に持ち上がることはない。
 */
function initKeyboardInsets() {
  const isTextField = (el) => !!el && /^(INPUT|TEXTAREA)$/.test(el.tagName);
  let focused = false;

  const sync = () => {
    const vv = window.visualViewport;
    const overlap = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    document.documentElement.style.setProperty('--kb', `${Math.round(overlap)}px`);

    // Android（resizes-content）は overlap が 0 になるので、入力欄のフォーカスも判定に使う。
    // 数 px のズレでクラスが点滅しないよう閾値を設ける。
    const open = window.innerWidth <= MOBILE_BREAKPOINT && (focused || overlap > 60);
    document.body.classList.toggle('kb-open', open);

    // 視覚ビューポートがずらされていたら戻す（キーボード表示時の自動スクロール対策）
    if (open && window.scrollY !== 0) window.scrollTo(0, 0);
  };

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', sync);
    window.visualViewport.addEventListener('scroll', sync);
  }

  document.addEventListener('focusin',  (e) => { if (isTextField(e.target)) { focused = true;  sync(); } });
  document.addEventListener('focusout', (e) => {
    if (!isTextField(e.target)) return;
    focused = false;
    // 入力欄どうしのフォーカス移動でちらつかないよう一拍おく
    setTimeout(() => { if (!isTextField(document.activeElement)) sync(); }, 120);
  });

  sync();
}

window.switchBottomNav     = switchBottomNav;
window.switchDiarySegment  = switchDiarySegment;
window.toggleNavSheet      = toggleNavSheet;
window.setNavOpen          = setNavOpen;
window.openSettings        = openSettings;
window.toggleMobileSideMenu = toggleMobileSideMenu;
window.closeMobileSideMenu  = closeMobileSideMenu;

// ========== アプリ初期化（パーシャルロード後に実行） ==========
loadAllPartials().then(async () => {
  initKeyboardInsets();

  syncResponsiveLayout();

  // Service Worker を使用しない（キャッシュ問題回避）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
  }

  // AI チャットの送信キー。
  // Enter は改行に使う（日本語入力の変換確定が Enter のため、Enter 送信だと変換中に誤送信しやすい）。
  // 送信は Ctrl+Enter / Cmd+Enter のみ。PC・モバイルとも送信ボタンから送れる。
  byId('chat-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendChat(); }
  });

  // この vault の人格（vault/persona/card.json）を中間サーバー経由でロードする。
  //
  // アクセスキー未設定では人格も見た目も読み込まない（未認証の訪問者には何も出さない）。
  //
  // 以前は persona.md の frontmatter を自前でパースしていたが、その実装には穴があった:
  //   - 正規表現が `\n` 決め打ちで、CRLF のファイルでは frontmatter が丸ごと本文に落ちる
  //   - `line.split(':')` なので、値の中にコロンがあると壊れる（例: greeting に時刻）
  // JSON にすればブラウザ標準のパーサが使えるので、この2つが構造的に消える。
  //
  // ここに置くのは「作者が書く人格」だけ。対話で変化するユーザー像や関係の記憶は
  // vault 側に置く（成長するのはそちらで、card.json ではない）。
  if (getToken()) {
    try {
      const card = await fetchPersonaCard();
      if (card) {
        window.AI_PERSONA = {
          name: card.name,
          userCallName: card.userCallName,
          // ペルソナの言語（persona-pack-spec §2 の予約フィールド）。
          // v1 のランタイム注入文（表情タグ案内等）は日本語のみで、この値はまだ参照しない。
          language: card.language || 'ja',
          defaultAvatar: card.defaultAvatar,   // 既定の見た目（assets/avatars/<slug>）。設定で上書きできる
          greeting: card.greeting,     // 起動時の挨拶（口調は人格に属する）
          // この人格が使ってはいけない語。返答を機械的に照合するために持つ。
          // 本文に「使わない」と書くだけでは守られないため、宣言を機械可読にしてある。
          avoidWords: Array.isArray(card.avoidWords) ? card.avoidWords : [],
          intro:       card.intro || '',
          sections:    Array.isArray(card.sections)    ? card.sections    : [],
          // 会話履歴の後ろに置く指示。前に置くより強く効くため、破られやすい規律の
          // 移動先として用意してある（現状は未使用）。
          postHistory: Array.isArray(card.postHistory) ? card.postHistory : []
        };
      }
    } catch (e) {
      console.warn('card.json の読み込みに失敗しました:', e);
    }
    // scene.json（表情差分・背景の定義）をロードする
    // 見た目の既定は card.json の defaultAvatar で決まるため、必ず人格の読み込みの後に行う。
    if (typeof AvatarScene !== 'undefined') {
      await AvatarScene.load();
    }
  }

  window.dispatchEvent(new Event('persona-loaded'));

  // 日記の見出しは PAT の有無に関わらず出す（本文だけが未設定メッセージになる）
  if (typeof renderReportHeading === 'function') renderReportHeading();

  const token = getToken();
  if (token) {
    await ConfigService.init();
    // 日記は裏側で先読みしておき、表示だけ対話画面を優先する
    fetchDailyReport();
    // 評価履歴を会話ログから復元する（端末をまたいで傾向を共有するため）。
    // await しない: 対話開始までブロックさせない。間に合わなければその回は localStorage だけで判定する。
    if (typeof ReplyFeedback !== 'undefined') ReplyFeedback.loadFromVault();
    const kintaiLink = byId('kintai-sheet-link');
    if (kintaiLink && getKintaiUrl()) kintaiLink.href = getKintaiUrl();

    // 起動直後の標準TOPは対話画面（デスクトップ・モバイル両方）
    if (window.innerWidth <= MOBILE_BREAKPOINT) {
      switchBottomNav('talk');
    } else if (typeof switchMainTab === 'function') {
      switchMainTab('ai');
    }
  } else {
    // PAT 未設定の場合は設定画面へ
    setTimeout(openSettings, 500);
  }
});
