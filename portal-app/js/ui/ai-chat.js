// =====================
// AI アシスタント（対話画面 / Ambient Companion）
// =====================
const SESSIONS_KEY = 'chat_sessions';

/**
 * 時間帯（朝・昼・夜）を取得する。
 * 朝: 5:00 - 10:59 / 昼: 11:00 - 17:59 / 夜: 18:00 - 4:59
 */
function getTimeOfDay(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 18) return 'noon';
  return 'night';
}

/**
 * 起動時の挨拶。口調は人格に属するので card.json の `greeting` から読む。
 * 時間帯（朝・昼・夜）に応じた挨拶に対応。
 */
const DEFAULT_WELCOME = {
  morning: 'おはよう！今日も無理せんとこな🍀 今日の体調や気分、コンディションはどう？',
  noon: 'こんにちは！調子はどう？午後も無理せずいこうな🍀',
  night: '今日もおつかれさま！ゆっくり休んでな🍀 何か話したいことある？'
};

function welcomeMsg() {
  const tod = getTimeOfDay();
  const personaGreeting = window.AI_PERSONA && window.AI_PERSONA.greeting;
  if (personaGreeting) {
    if (typeof personaGreeting === 'object' && personaGreeting[tod]) {
      return personaGreeting[tod];
    }
    if (typeof personaGreeting === 'string') {
      return personaGreeting;
    }
  }
  return DEFAULT_WELCOME[tod] || DEFAULT_WELCOME.morning;
}

/** 文字送りの間隔（ms）。デザイン指定値。 */
const TYPE_INTERVAL = 42;
/** 会話ログに残すユーザー発言の数 */
const BACKLOG_MAX = 3;
/** 返信候補が取れなかったときの既定文言（何か答えてもらった直後を想定） */
const DEFAULT_REPLIES = ['もう少し詳しく', 'ありがとう'];
/** 起動時の挨拶に対する既定文言（時間帯別）。 */
const WELCOME_REPLIES = {
  morning: ['体調・気分はバッチリ！', 'ちょっと疲れ気味かも'],
  noon: ['順調だよ', '少し休憩する'],
  night: ['今日もおつかれさま', '聞いてほしいことがある']
};

function getWelcomeReplies() {
  const tod = getTimeOfDay();
  return WELCOME_REPLIES[tod] || WELCOME_REPLIES.morning;
}

let chatHistory   = [];
let reflectResult = '';
let currentSession = null;   // { id, title, messages }
let attachedFiles  = [];     // [{ path, content, sha }]
const applyBlocks  = new Map(); // blockId → { path, content }

// VN テキストページング
// vnPages は { text, expression, background } の配列（ページ単位で表情を切り替える）
let vnPages       = [];
let vnCurrentPage = 0;
let vnIsTyping    = false;
let vnTypingTimer = null;

/** 直近 BACKLOG_MAX 件のユーザー発言（新しいものが末尾） */
let vnBacklog = [];
/** 返信候補（常に2つ） */
let vnReplies = [...DEFAULT_REPLIES];

/**
 * AI の名前。settings.js の getAiName() が未ロードでも壊れないようにする
 * （パーシャルは並列ロードのため、panel-settings.html の到着順は保証されない）。
 */
function safeAiName() {
  if (typeof getAiName === 'function') return getAiName();
  return (window.AI_PERSONA && window.AI_PERSONA.name) || 'AI';
}

/** アニメーションを抑制する設定か */
function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 返答から返信候補タグ [候補:A|B] を抜き出し、タグを除いた本文とともに返す。
 * 表情・背景タグは AvatarScene.parseCues が扱うため、ここでは候補だけを見る。
 */
function extractReplyChips(rawText) {
  const TAG = /\[\s*(?:候補|返信候補|返信|reply|replies)\s*[:：]\s*([^\]]+?)\s*\]/gi;
  const found = [];
  const text  = String(rawText || '').replace(TAG, (_, body) => {
    body.split(/[|｜/／、,]/).forEach(s => {
      const t = s.trim();
      if (t) found.push(t);
    });
    return '';
  });
  return { text, replies: found.slice(0, 2) };
}

/**
 * 表情タグ付きの応答を「ページ配列」に変換する。
 * タグで区切られたセグメントごとにページ分割し、各ページへ表情を引き継がせる。
 */
function buildVnPages(rawText) {
  if (typeof AvatarScene === 'undefined') {
    return splitIntoVnPages(rawText).map(text => ({ text, expression: null, background: null }));
  }

  const parsed = AvatarScene.parseCues(rawText);
  const pages  = [];
  let carried  = null;   // タグが無いページは直前の表情を引き継ぐ

  parsed.segments.forEach(seg => {
    const expression = seg.expression || null;
    const chunks = splitIntoVnPages(seg.text);
    if (chunks.length === 0) {
      // テキストを伴わないタグ単体（先頭タグなど）は次のページへ持ち越す
      if (expression) carried = expression;
      if (seg.background) pages.push({ text: '', expression: null, background: seg.background, cueOnly: true });
      return;
    }
    chunks.forEach((text, i) => {
      pages.push({
        text,
        expression: i === 0 ? (expression || carried) : null,
        background: i === 0 ? (seg.background || null) : null
      });
    });
    carried = null;
  });

  // タグが1つも無い場合は文面から推定して最初のページに載せる
  const hasAnyExpression = pages.some(p => p.expression);
  if (!hasAnyExpression && pages.length > 0) {
    pages[0].expression = AvatarScene.inferExpression(parsed.clean);
  }

  const visible = pages.filter(p => !p.cueOnly || p.background);
  return visible.length > 0 ? visible : [{ text: parsed.clean, expression: null, background: null }];
}

/** ページ配列を表示用テキストへ戻す（会話ログ・履歴保存用） */
function vnPagesToText(pages) {
  return pages.map(p => p.text).join('');
}

function splitIntoVnPages(text) {
  const MAX_CHARS = 60; // 1行あたり30文字前後×2行を想定
  // 句読点、感嘆符、改行で分割
  let segs = text.split(/(?<=[。！？\n])/g).filter(s => s.length > 0);
  const pages = [];
  let cur = '';

  for (let s of segs) {
    // セグメント自体が長い場合は強制分割
    while (s.length > MAX_CHARS) {
      if (cur.length > 0) {
        pages.push(cur.trim());
        cur = '';
      }
      pages.push(s.slice(0, MAX_CHARS).trim());
      s = s.slice(MAX_CHARS);
    }

    if (cur.length + s.length > MAX_CHARS && cur.length > 0) {
      pages.push(cur.trim());
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur.trim()) pages.push(cur.trim());
  
  if (pages.length === 0 && text.trim().length > 0) {
    pages.push(text.trim());
  }
  return pages;
}

/** 台詞の送り状態（送り中 / 送り終わり）を UI へ反映する */
function renderVnFooter(isTyping) {
  const counter   = document.getElementById('vn-page-counter');
  const indicator = document.getElementById('vn-advance-indicator');
  const caret     = document.getElementById('vn-caret');

  if (counter) {
    counter.textContent = vnPages.length > 0 ? `${vnCurrentPage + 1} / ${vnPages.length}` : '';
  }

  if (caret) caret.classList.toggle('is-done', !isTyping);

  if (indicator) {
    const isLast = vnCurrentPage >= vnPages.length - 1;
    indicator.textContent = isTyping ? 'タップで全文' : (isLast ? 'おわり' : 'つづき');
    indicator.classList.toggle('is-done', !isTyping);
  }
}

function typeWriterEffect(element, text, callback) {
  if (vnTypingTimer) clearTimeout(vnTypingTimer);

  // prefers-reduced-motion では文字送りを飛ばして全文表示する
  if (prefersReducedMotion()) {
    element.textContent = text;
    vnIsTyping = false;
    if (callback) callback();
    return;
  }

  vnIsTyping = true;
  let i = 0;
  element.textContent = '';
  renderVnFooter(true);

  function type() {
    if (i < text.length) {
      element.append(text.charAt(i));
      i++;
      vnTypingTimer = setTimeout(type, TYPE_INTERVAL);
    } else {
      vnIsTyping = false;
      if (callback) callback();
    }
  }
  type();
}

function showVnPage(idx) {
  const textEl = document.getElementById('vn-typed');
  if (!textEl) return;

  const page = vnPages[idx] || { text: '' };

  // ページに紐づく表情・背景を先に反映してから喋らせる
  if (typeof AvatarScene !== 'undefined') {
    if (page.background) AvatarScene.setBackground(page.background);
    if (page.expression) AvatarScene.setExpression(page.expression);
  }

  typeWriterEffect(textEl, page.text || '', () => renderVnFooter(false));
}

/**
 * 台詞ボックスのタップ:
 *   送り中     → 全文を即表示
 *   送り終わり → 次のページへ（最終ページなら何もしない）
 */
function advanceVnText() {
  const box = document.getElementById('vn-dialogue-box');
  if (box && box.classList.contains('thinking')) return; // 考え中は無視

  if (vnIsTyping) {
    if (vnTypingTimer) clearTimeout(vnTypingTimer);
    vnIsTyping = false;
    const textEl = document.getElementById('vn-typed');
    if (textEl) textEl.textContent = (vnPages[vnCurrentPage] && vnPages[vnCurrentPage].text) || '';
    renderVnFooter(false);
    return;
  }

  if (vnCurrentPage < vnPages.length - 1) {
    vnCurrentPage++;
    showVnPage(vnCurrentPage);
  }
}

/** 返答をページ配列に載せて先頭から喋らせる */
function startVnDialogue(rawText) {
  vnPages = buildVnPages(rawText);
  vnCurrentPage = 0;
  showVnPage(0);
}

// ---- 会話ログ（直近3件のユーザー発言） ----
function renderVnBacklog() {
  const logEl = document.getElementById('vn-user-log');
  if (!logEl) return;
  logEl.innerHTML = '';

  // 新しいものを下に積み、古いものほど薄くする
  vnBacklog.forEach((text, i) => {
    const entry = document.createElement('div');
    entry.className = 'vn-user-entry';
    entry.dataset.age = String(vnBacklog.length - 1 - i);
    entry.textContent = text;
    logEl.appendChild(entry);
  });
}

function pushVnBacklog(text) {
  vnBacklog.push(text);
  if (vnBacklog.length > BACKLOG_MAX) vnBacklog = vnBacklog.slice(-BACKLOG_MAX);
  renderVnBacklog();
}

// ---- 返信候補（常に2つ） ----
function renderVnReplies() {
  const el = document.getElementById('vn-replies');
  if (!el) return;
  el.innerHTML = '';

  const list = (vnReplies && vnReplies.length ? vnReplies : DEFAULT_REPLIES).slice(0, 2);
  while (list.length < 2) list.push(DEFAULT_REPLIES[list.length] || 'ありがとう');

  list.forEach(label => {
    const btn = document.createElement('button');
    btn.className = 'vn-reply-chip';
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', () => pickVnReply(label));
    el.appendChild(btn);
  });
}

/** 返信候補のタップ = その文言をそのまま送信して次の往復へ進む */
function pickVnReply(text) {
  const input = document.getElementById('chat-input');
  if (!input) return;
  // どの候補を選んだかを応答スタイルの評価として記録する
  if (typeof ReplyFeedback !== 'undefined') ReplyFeedback.record('chip', text);
  input.value = text;
  sendChat({ fromChip: true });
}

/**
 * 「📝 日記に書く」= アバターに「日記に書いて」と言う手間の省略。
 * フォームから直接書き込む方式（旧 diary-note-panel）は廃止した。
 * 何を書くかは会話の文脈から AI が決め、append_to_file で追記する。
 */
function requestDiaryWrite() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  input.value = '日記に書いて';
  sendChat({ viaButton: true });
  if (typeof setNavOpen === 'function') setNavOpen(false);
}

// ---- Session management ----
function getSessions() { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); }
function saveSessions(s) { localStorage.setItem(SESSIONS_KEY, JSON.stringify(s.slice(0, 30))); }

function saveCurrentSession() {
  if (!currentSession) return;
  currentSession.messages = [...chatHistory];
  const all = getSessions();
  const idx = all.findIndex(s => s.id === currentSession.id);
  const updated = { ...currentSession, updatedAt: Date.now() };
  if (idx >= 0) all[idx] = updated; else all.unshift(updated);
  saveSessions(all);
}

function newChatSession() {
  if (currentSession && chatHistory.length > 0) saveCurrentSession();
  currentSession = { id: Date.now().toString(), title: '新しい会話', messages: [] };
  chatHistory = []; attachedFiles = [];
  if (typeof CounselMode !== 'undefined') CounselMode.reset();
  renderChatPanel(); closeSessionDropdown();
}

function loadSession(id) {
  if (currentSession && chatHistory.length > 0) saveCurrentSession();
  const s = getSessions().find(s => s.id === id);
  if (!s) return;
  currentSession = { ...s };
  chatHistory = s.messages ? [...s.messages] : [];
  attachedFiles = [];
  if (typeof CounselMode !== 'undefined') CounselMode.reset();
  renderChatPanel(); closeSessionDropdown();
}

function deleteSession(id, e) {
  e.stopPropagation();
  saveSessions(getSessions().filter(s => s.id !== id));
  if (currentSession && currentSession.id === id) newChatSession();
  else renderSessionDropdown();
}

function renderChatPanel() {
  const titleEl = document.getElementById('session-title-display');
  if (titleEl) titleEl.textContent = currentSession ? currentSession.title : '新しい会話';

  // 立ち絵・背景の描画は AvatarScene が担う
  if (typeof AvatarScene !== 'undefined') AvatarScene.mount();

  const nameLabel = document.getElementById('vn-ai-name-label');
  if (nameLabel) nameLabel.textContent = safeAiName();

  const input = document.getElementById('chat-input');
  if (input) input.placeholder = `${safeAiName()}に話しかける`;

  // 会話ログは履歴の末尾から直近3件のユーザー発言を復元する
  vnBacklog = chatHistory.filter(m => m.role === 'user').slice(-BACKLOG_MAX).map(m => m.content);
  renderVnBacklog();

  const lastAi = [...chatHistory].reverse()
    .find(m => m.role === 'assistant' || m.role === 'model');
  showAiReply(lastAi ? lastAi.content : welcomeMsg());

  renderFileChips();
}

function toggleSessionDropdown() {
  const dd = document.getElementById('session-dropdown');
  if (dd.classList.contains('is-hidden')) {
    renderSessionDropdown();
    dd.classList.remove('is-hidden');
  } else {
    dd.classList.add('is-hidden');
  }
}
function closeSessionDropdown() { document.getElementById('session-dropdown').classList.add('is-hidden'); }

function renderSessionDropdown() {
  const sessions = getSessions();
  const dd = document.getElementById('session-dropdown');
  if (sessions.length === 0) {
    dd.innerHTML = '<div style="padding:10px 12px;font-size:0.78rem;color:#888;">会話履歴なし</div>';
    return;
  }
  dd.innerHTML = sessions.map(s => {
    const dt  = new Date(parseInt(s.updatedAt || s.id));
    const lbl = dt.toLocaleDateString('ja-JP', { month:'numeric', day:'numeric' }) + ' '
              + dt.toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit' });
    const active = currentSession && s.id === currentSession.id ? ' active' : '';
    return `<div class="session-item${active}" onclick="loadSession('${s.id}')">
      <div class="session-item-title">${escapeHtml(s.title)}</div>
      <div class="session-item-meta">${lbl}
        <span class="session-del" onclick="deleteSession('${s.id}',event)">✕</span>
      </div>
    </div>`;
  }).join('');
}

document.addEventListener('click', e => {
  if (!e.target.closest('.chat-session-bar')) closeSessionDropdown();
});

// ---- File attachment ----
async function promptFileAttach() {
  const path = prompt('ファイルパスを入力\n例: vault/knowledge/memo.md');
  if (!path) return;
  await fetchFileForAttach(path.trim());
}

async function fetchFileForAttach(path) {
  try {
    const res = await GitHubStorage.getFile(path);
    if (!res) { alert(`ファイルが見つかりません:\n${path}`); return; }
    attachedFiles = attachedFiles.filter(f => f.path !== path);
    attachedFiles.push({ path, content: res.content, sha: res.sha });
    renderFileChips();
  } catch(e) { alert('ファイル取得エラー: ' + e.message); }
}

function removeAttachedFile(idx) { attachedFiles.splice(idx, 1); renderFileChips(); }

function renderFileChips() {
  const el = document.getElementById('file-chips');
  if (attachedFiles.length === 0) { el.classList.add('is-hidden'); el.innerHTML = ''; return; }
  el.classList.remove('is-hidden');
  el.innerHTML = attachedFiles.map((f, i) =>
    `<span class="file-chip">📄 ${escapeHtml(f.path.split('/').pop())}
      <span class="file-chip-remove" onclick="removeAttachedFile(${i})">✕</span>
    </span>`).join('');
}

// ---- Message rendering ----

/**
 * AI の返答を台詞ボックスへ載せる。
 * 返信候補タグを先に切り出し、残りを表情タグ付きのページ配列にする。
 */
/**
 * 返答を作れなかったときの表示。文字送りせず、失敗が起きたことを台詞ボックスに直接出す。
 * 以前は空返答（ツール往復の上限到達・空のcandidates）のとき「考えています…」のまま
 * 黙って止まり、ユーザーには何も起きていないように見えていた。
 */
function showChatFailure(text) {
  if (typeof AvatarScene !== 'undefined') AvatarScene.setExpression('worried');
  if (vnTypingTimer) clearTimeout(vnTypingTimer);
  vnIsTyping = false;
  vnPages = [{ text, expression: null, background: null }];
  vnCurrentPage = 0;
  const textEl = document.getElementById('vn-typed');
  if (textEl) textEl.textContent = text;
  renderVnFooter(false);
}

/**
 * @param {string} rawText 表情・候補タグ付きの返答原文
 * @param {{speak?: boolean}} opts speak:true で 3D アバターに喋らせる（新しい返答のときだけ。
 *   起動時の挨拶や履歴の再表示では喋らせない）
 */
function showAiReply(rawText, opts = {}) {
  const box = document.getElementById('vn-dialogue-box');
  if (box) box.classList.remove('thinking');

  const { text, replies } = extractReplyChips(rawText);
  if (opts.speak && typeof AvatarScene !== 'undefined') {
    AvatarScene.speak(AvatarScene.parseCues(text).clean);
  }
  // 候補タグが無いときの既定は、台詞の内容に噛み合うほうを選ぶ
  const fallback = text.trim() === welcomeMsg() ? getWelcomeReplies() : DEFAULT_REPLIES;
  vnReplies = replies.length ? replies : [...fallback];
  renderVnReplies();

  startVnDialogue(text);
}

function appendChatBubble(role, text) {
  if (role.includes('ai')) {
    const box    = document.getElementById('vn-dialogue-box');
    const typedEl = document.getElementById('vn-typed');
    if (!box || !typedEl) return null;

    const isThinking = role.includes('thinking');
    if (isThinking) {
      if (vnTypingTimer) clearTimeout(vnTypingTimer);
      vnIsTyping = false;
      box.classList.add('thinking');
      typedEl.textContent = '考えています…';
      const indicator = document.getElementById('vn-advance-indicator');
      if (indicator) indicator.textContent = '';
      if (typeof AvatarScene !== 'undefined') AvatarScene.setExpression('thinking');
    } else {
      showAiReply(text);
    }
    return box;
  }

  pushVnBacklog(text);
  return document.getElementById('vn-user-log');
}

/**
 * 返答を作れなかった事実も会話ログへ残す。
 * ユーザー発話だけ記録されて AI 発話が欠けたログからは「生成に失敗した」のか
 * 「書き込みに失敗した」のかを切り分けられなかったため（8/17・8/18 の「日記に書いて」で実発生）。
 * 括弧の中身が close/more/free/other でない行は parseLog が読まないので、評価集計は汚さない。
 */
function logChatFailure(reason) {
  if (typeof ConversationLog === 'undefined') return;
  ConversationLog.enqueue({
    role: 'ai',
    speaker: 'システム',
    text: `（返答を作れませんでした: ${reason || '不明'}）`,
    sessionId: currentSession ? currentSession.id : '',
    sessionTitle: currentSession ? currentSession.title : ''
  });
  ConversationLog.flush().catch(err => console.warn('会話ログの保存に失敗しました:', err));
}

/**
 * 応答に内部の思考メモ・指示の復唱が混ざっているか（2026-08-25 に「思考プロセス：1. 表情…」がそのまま表示された）。
 * 誤検出しても被害は「1回出し直す」だけなので、はっきりした痕跡だけを見る。
 */
function looksLikeThoughtLeak(text) {
  const t = String(text || '').replace(/\[[^\]]*\]/g, '');
  return /思考プロセス|返答は[3-4]文以内|候補タグ付与|関西弁。|^\s*ユーザーは[「『][^」』]*[」』]と.{0,40}(?:考えている|言っている|尋ねている|話している)/m.test(t);
}

// ---- Agentic Send Chat ----
/**
 * @param {{fromChip?: boolean, viaButton?: boolean}} opts
 *   fromChip:true は返信候補のタップ経由（記録済み）。
 *   viaButton:true は「📝 日記に書く」等のボタン経由（定型文なので候補評価に数えない）。
 */
async function sendChat(opts = {}) {
  if (!getGeminiKey()) {
    alert('⚙️ 設定から Gemini API キー を先に設定してください。');
    return;
  }

  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;

  // 候補を使わず自分で書いた = 候補が的外れだったという評価として記録する
  if (!opts.fromChip && !opts.viaButton && typeof ReplyFeedback !== 'undefined') ReplyFeedback.record('free', text);

  const btn = document.getElementById('chat-send-btn');
  btn.disabled = true; input.value = '';
  // 音声の自動再生制限は、ユーザー操作の直後でないと解除できない（LLM 応答待ちの後では手遅れ）
  if (typeof AvatarScene !== 'undefined') AvatarScene.unlockAudio();
  appendChatBubble('user', text);
  chatHistory.push({ role: 'user', content: text });
  if (typeof CounselMode !== 'undefined') CounselMode.update(text, !!opts.viaButton);

  if (chatHistory.length === 1 && currentSession && currentSession.title === '新しい会話') {
    currentSession.title = text.slice(0, 28) + (text.length > 28 ? '…' : '');
    document.getElementById('session-title-display').textContent = currentSession.title;
  }
  saveCurrentSession();

  // 会話ログ（要約せず全文を逐次記録）
  // 評価種別も一緒に残す。集計は localStorage にしか無く端末を替えると消えるため、
  // 「どの発話がどう評価されたか」を後から追えるようにしておく
  if (typeof ConversationLog !== 'undefined') {
    ConversationLog.enqueue({
      role: 'user',
      speaker: 'ユーザー',
      text,
      feedback: opts.viaButton
        ? 'ボタン'   // 定型文の送信。評価集計の対象外（parseLog が close/more/free/other 以外を読まないことに依る）
        : (typeof ReplyFeedback !== 'undefined'
            ? ReplyFeedback.kindOf(opts.fromChip ? 'chip' : 'free', text)
            : ''),
      sessionId: currentSession ? currentSession.id : '',
      sessionTitle: currentSession ? currentSession.title : ''
    });
  }

  const thinking = appendChatBubble('ai thinking', '考えています…');

  const aiName = getAiName();
  const persona = getAiPrompt();

  // 悩み・迷いの相談中は、応答スタイルの締め付け（3文以内／掘り下げ2回まで）を緩めて深掘りさせる
  const counseling = typeof CounselMode !== 'undefined' && CounselMode.active;

  let sys = `あなたは「${aiName}」として振る舞ってください。
人格・口調設定：${persona}

${getJstNowContext()}

利用可能なポータル機能（ツールを使って実行してください）：
- ファイルの保存・読込・一覧取得（日記やナレッジ管理）
- タスクの追加・更新・取得（リポジトリ内の tasks.json を管理）
- 日記の統合・エクスポート

## 応答スタイル（画面の制約。口調や人格は上の「人格・口調設定」に従う）
- 台詞は1ページずつ表示されるため、**1回の返答は${counseling ? '3文以内（相談モード。1文は短く）' : '原則2文、多くても3文まで'}**に収めてください。前置き・言い換え・要約の繰り返しをしない。
- 共感や励ましを添える場合も1文だけにしてください（言葉選びは人格設定に従う）。
- 朝の挨拶時や、ユーザーからの体調・気分・コンディションの報告に対しては、無理をさせず温かく寄り添い、その日の過ごし方や労いの言葉をかけてください。
- 同じ入り方・同じ締め方を続けて使わないでください。毎回同じ言葉で締めない。
- 「〜のメリットは？」のように情報や選択肢を求められたら、**まず内容で答えて**ください。質問を質問で返さない。
${counseling ? '' : '- 掘り下げの問いかけは連続2回までにしてください。2回で答えが出なければ、あなたから案を出して選んでもらう。\n'}- ユーザーが「ありがとう」など会話を閉じる言葉を送ったら、直前の質問を蒸し返さず短く締めてください。

## 記録の書き込み方（この節は最優先で守る）
- **「日記に書いといて」「追記して」と言われたら append_to_file を使ってください。**
  既存の内容はアプリが保持するので、追記したい文章だけを渡せば済みます。
- 対象を言わずに「日記に書いて」「記録して」とだけ頼まれたら、**何を書くか聞き返さず**、
  直前の話題から残す価値のある内容を1〜3行にまとめて書いてください。何を書いたかは報告で伝わります。
  直前の話題がどうしても特定できないときだけ、候補を挙げて確認してください。
- **日記に書くのは、ユーザーが話した事実・出来事・気持ちだけです。**
  「〜な様子」「〜と感じられる」「少し落ち着いたようだ」のような、あなたから見た評価・感想・分析は書かないでください。
  気持ちを書くときは、ユーザー自身が言った言葉や、その日の出来事として書いてください（例:「愚痴を言って気持ちが軽くなった」ではなく「仕事の愚痴を話した」）。
- **save_file はファイルを丸ごと置き換えます。**既存の内容は消えます。
  置き換えが必要な場合だけ使い、必ず先に read_file で現在の中身を取得して、
  残したい部分を含めた全文を渡してください。

## ツール実行の報告（この節は最優先で守る）
- **ツールを実行していないことを「やった」と言わないでください。** 保存・記録・登録したと述べてよいのは、
  実際にツールを呼び、その結果が返ってきた後だけです。
- 書き込み系ツールの結果には \`ok\` が含まれます。**\`ok: true\` を確認してから報告**してください。
  \`ok: false\` のときは失敗です。成功したことにしないでください。
- 報告には**何を・どこに**を入れて1行で伝えてください。
  例:「◯◯という内容を、今日の日記に書いたで」。「書いといたで」だけでは何を書いたか分かりません。
- 失敗したときは、**謝罪は1文まで**にして、次にどうするか（もう一度試す／別の場所に保存する／ユーザーに任せる）を必ず添えてください。
- ユーザーに確認が必要な場合は、ツールを実行する前に問いかけてください。

## 返信候補（必須）
返答の最後に、ユーザーがそのまま送れる短い返信を2つ、次の形式で必ず付けてください。
　[候補:1つめ|2つめ]
- その返答に対して実際に返しそうな言葉にしてください（例: 質問で終えたなら答えの選択肢、説明したなら「もっと詳しく」）。
- 各12文字以内。ユーザーの一人称・口調で書く（あなたの口調ではありません）。
- このタグは画面には表示されず、ボタンのラベルになります。本文には含めないでください。

${typeof AvatarScene !== 'undefined' ? AvatarScene.promptGuide() : ''}

${typeof ReplyFeedback !== 'undefined' ? ReplyFeedback.promptGuide(chatHistory, { relaxLength: counseling }) : ''}

${counseling ? CounselMode.promptBlock() : ''}

${typeof PersonaState !== 'undefined' ? PersonaState.promptGuide() : ''}

## 覚えておくこと
- **「覚えといて」「これ覚えておいて」と明示的に頼まれたときだけ** remember_about_user を使ってください。
- 頼まれていないのに勝手に記録しないでください。何を覚えられたかユーザーが把握できなくなります。
- 記録したら「何を・どのセクションに」を1行で伝えてください。

## ツール選択の指針
- 「今日のタスク」「今日やること」など当日のリマインドを聞かれた場合は get_today_reminders を優先してください。
- get_tasks は長期バックログ（P1〜P3）用です。明示的にバックログを尋ねられた場合のみ使用してください。

## ファイル保存先の規約
- この会話そのものは、アプリが1往復ごとに vault/conversations/YYYY-MM-DD_アバター会話.md へ全文を自動記録しています。改めて保存する必要はありません。
- テーマを立てて別途まとめたい場合のみ: vault/conversations/YYYY-MM-DD_テーマ.md
- 日記（当月・日別）: vault/diary/YYYY-MM-DD.md
- 日記（過去月・月次まとめ）: vault/diary/YYYY/YYYY-MM.md ← 年ディレクトリの下にあります。過去の日記を探すときはまず vault/diary を list_files し、年ディレクトリ（例 2026）の中を見てください。
- 構造化されたナレッジ・学び: vault/knowledge/
- ファイル名の YYYY-MM-DD には上記「現在日時」の値を使い、「今日の〜」のような日付が特定できない名前は付けないでください。`;

  const latest = await AiService.getLatestContext();
  if (latest) sys += `\n\n## 現在のコンテキスト\n${latest}`;
  
  if (attachedFiles.length > 0) {
    sys += '\n\n## 添付ファイル:';
    attachedFiles.forEach(f => { sys += `\n\n### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``; });
  }

  let currentContents = chatHistory.map(msg => ({
    role: msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user',
    parts: [{ text: msg.content }]
  }));

  try {
    // この往復でどのファイルを読んだかを記録し直す（save_file の上書きガード用）
    if (typeof ToolDispatcher !== 'undefined') ToolDispatcher.beginTurn();

    let loop = true;
    let maxIter = 5;
    let finalReply = "";
    let failReason = '';
    let leakRetried = false;   // 思考漏出の再生成は1往復につき1回まで

    while (loop && maxIter-- > 0) {
      const data = await callGeminiRaw(currentContents, sys, ToolDefinitions);
      const candidate = data.candidates?.[0];
      const message   = candidate?.content;

      // 思考トークンが出力枠を使い切ると parts の無い content が返る（finishReason: MAX_TOKENS）。
      // 以前はここで message.parts.filter が例外になり、失敗理由がどこにも残らなかった。
      const parts = Array.isArray(message?.parts) ? message.parts : [];
      if (parts.length === 0) {
        failReason = candidate?.finishReason || '応答が空でした';
        break;
      }

      currentContents.push(message);

      const toolCalls = parts.filter(p => p.functionCall);
      if (toolCalls.length > 0) {
        const responses = [];
        for (const call of toolCalls) {
          const result = await ToolDispatcher.dispatch(call.functionCall.name, call.functionCall.args);
          responses.push({
            functionResponse: {
              name: call.functionCall.name,
              response: { result: result }
            }
          });
        }
        currentContents.push({ role: 'user', parts: responses });
      } else {
        const text = parts.map(p => p.text || '').join('');
        // 内部の思考メモが本文に混ざった場合は、そのまま表示せず1回だけ出し直させる
        if (!leakRetried && looksLikeThoughtLeak(text)) {
          leakRetried = true;
          console.warn('思考メモの混入を検出したため再生成します:', text.slice(0, 80));
          currentContents.push({ role: 'user', parts: [{ text:
            '（システム）直前の出力に内部の思考メモが混ざっていました。返答の本文だけを、人格・口調のまま、返信候補タグを付けて出し直してください。' }] });
          continue;
        }
        loop = false;
        finalReply = text;
      }
    }
    if (!finalReply && !failReason) failReason = 'ツール往復が上限に達しました';
    
    if (thinking) thinking.classList.remove('thinking');
    if (finalReply) {
      showAiReply(finalReply, { speak: true });
      // 履歴にはタグ付きの原文を残す（再表示時に buildVnPages / extractReplyChips が取り除く）
      chatHistory.push({ role: 'assistant', content: finalReply });
      saveCurrentSession();

      const shownText = vnPagesToText(vnPages);

      // 人格が宣言した禁止語を使っていないか照合する。
      // 見つかれば次のリクエストの promptGuide() が名指しで是正する。
      if (typeof ReplyFeedback !== 'undefined') {
        const hits = ReplyFeedback.checkViolation(shownText);
        if (hits.length) console.warn('人格の禁止語が使われました:', hits);
      }

      // 会話ログへ追記（表示された全文をそのまま）
      if (typeof ConversationLog !== 'undefined') {
        ConversationLog.enqueue({
          role: 'ai',
          speaker: getAiName(),
          text: shownText,
          expression: vnPages.find(p => p.expression)?.expression || '',
          sessionId: currentSession ? currentSession.id : '',
          sessionTitle: currentSession ? currentSession.title : ''
        });
        ConversationLog.flush().catch(err => console.warn('会話ログの保存に失敗しました:', err));
      }
    } else {
      // 空返答（思考トークン切れ・ツール往復の上限など）。黙って止めず、失敗として見せる。
      // 依頼したユーザー発話は履歴に残す。消すと「も一回」と言われたとき何の話か分からなくなる（8/18 実発生）
      console.warn('Chat 空返答:', failReason);
      showChatFailure('返事を作れませんでした。「もう一回」と送ってもらえたら、続きから試します。');
      logChatFailure(failReason);
    }
  } catch (e) {
    console.error('Chat Error:', e);
    if (thinking) thinking.classList.remove('thinking');
    showChatFailure(`エラー: ${e.message}`);
    logChatFailure(e.message);
  } finally { btn.disabled = false; input.focus(); }
}

function clearChat() {
  chatHistory = [];
  if (typeof CounselMode !== 'undefined') CounselMode.reset();
  if (currentSession) { currentSession.messages = []; saveCurrentSession(); }
  vnBacklog = [];
  renderVnBacklog();
  showAiReply(welcomeMsg());   // 返信候補は showAiReply が挨拶用に切り替える
  attachedFiles = []; renderFileChips();
  if (typeof setNavOpen === 'function') setNavOpen(false);
}

// ---- Session init ----
(function initSession() {
  const sessions = getSessions();
  if (sessions.length > 0) {
    currentSession = { ...sessions[0] };
    chatHistory = sessions[0].messages ? [...sessions[0].messages] : [];
  } else {
    currentSession = { id: Date.now().toString(), title: '新しい会話', messages: [] };
    chatHistory = [];
  }
  renderChatPanel();
})();

function switchChatSession(id) { loadSession(id); }

window.sendChat = sendChat;
window.clearChat = clearChat;
window.newChatSession = newChatSession;
window.switchChatSession = switchChatSession;
window.toggleSessionDropdown = toggleSessionDropdown;
window.advanceVnText = advanceVnText;
window.promptFileAttach = promptFileAttach;
window.pickVnReply = pickVnReply;
window.requestDiaryWrite = requestDiaryWrite;
window.initChat = function() { renderChatPanel(); };

// ペルソナ読み込み後に名前・プレースホルダ・表情チップを整える
window.addEventListener('persona-loaded', () => renderChatPanel());
