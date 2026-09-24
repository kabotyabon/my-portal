// =====================
// 日記 Viewer
// =====================
let reportContent = '';
let reportSha = '';
let reportTab = 'edit';
let reportPath = '';

function getDailyReportPaths () {
  const jst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const y = jst.getFullYear();
  const m = String(jst.getMonth() + 1).padStart(2, '0');
  const d = String(jst.getDate()).padStart(2, '0');
  return [`vault/diary/${y}-${m}-${d}.md`];
}

function getDailyReportPath () {
  return reportPath || getDailyReportPaths()[0];
}

/** 日記シートの日付ラベルと見出し（例「7月31日の記録」）を描画する。
    漢数字は日付をひと目で読み取れないため算用数字に統一した。 */
function renderReportHeading () {
  const jst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const y = jst.getFullYear();
  const m = jst.getMonth() + 1;
  const d = jst.getDate();

  const dateEl = document.getElementById('report-date-label');
  if (dateEl) dateEl.textContent = `${y}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}`;

  const headEl = document.getElementById('report-heading');
  if (headEl) headEl.textContent = `${m}月${d}日の記録`;
}

async function fetchDailyReport () {
  renderReportHeading();

  const token = getToken();
  if (!token) {
    document.getElementById('report-preview').innerHTML = '<p class="md-empty">設定からアクセスキーを設定すると日記を表示します</p>';
    return;
  }

  const metaEl = document.getElementById('report-meta');
  const previewEl = document.getElementById('report-preview');
  metaEl.textContent = '取得中…';

  try {
    const diary = await DiaryService.getTodayDiary();
    
    reportContent = diary.content;
    reportSha = diary.sha;
    reportPath = diary.path;

    if (!reportSha) {
      previewEl.innerHTML = '<p class="md-empty">日記がまだ作成されていません。<br>「↻ 日記を再生成」で生成してください。</p>';
      metaEl.textContent = '日記ファイルなし';
      return;
    }

    renderCurrentTab();
    const now = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    metaEl.textContent = `最終更新 ${now}`;
  } catch (e) {
    metaEl.textContent = 'ネットワークエラー';
  }
}

function switchMainTab (name) {
  const tabs = ['report', 'ai', 'archive', 'settings'];
  const enabledTabs = tabs.filter(t => !!document.getElementById('main-panel-' + t));

  const fallback = enabledTabs.includes('report')
    ? 'report'
    : (enabledTabs[0] || 'report');
  const target = enabledTabs.includes(name) ? name : fallback;

  tabs.forEach(t => {
    const tabEl = document.getElementById('mtab-' + t);
    const panelEl = document.getElementById('main-panel-' + t);
    const isActive = t === target;

    if (tabEl) tabEl.classList.toggle('active', isActive);
    if (!panelEl) return;

    panelEl.classList.toggle('is-hidden', !isActive);
    if (isActive) panelEl.style.removeProperty('display');
  });

  if (target === 'settings' && typeof initSettingsTab === 'function') {
    initSettingsTab();
  }
  if (target === 'archive' && typeof initArchivePanel === 'function') {
    initArchivePanel();
  }
}

function switchTab (tab) {
  reportTab = tab;
  renderCurrentTab();
}

function renderCurrentTab () {
  const p = document.getElementById('report-preview');
  const e = document.getElementById('report-edit');
  const tp = document.getElementById('tab-preview');
  const te = document.getElementById('tab-edit');
  if (!p || !e || !tp || !te) return;

  if (reportTab === 'preview') {
    p.classList.remove('is-hidden');
    e.classList.add('is-hidden');
    tp.classList.add('active');
    te.classList.remove('active');
    p.innerHTML = renderMarkdown(reportContent || '（日記がまだありません）');
    attachMdCheckboxListeners();
  } else {
    p.classList.add('is-hidden');
    e.classList.remove('is-hidden');
    tp.classList.remove('active');
    te.classList.add('active');
    const textarea = document.getElementById('report-textarea');
    if (textarea) textarea.value = reportContent;
  }
}

// =====================
// 日記セクションの upsert / 追記
// =====================

function escapeRegExpForSection (s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 「## タイトル」から次の「## 」の前、または末尾まで
function buildSectionRegex (title) {
  return new RegExp(`## ${escapeRegExpForSection(title)}\\n(?:[\\s\\S]*?)(?=\\n## |$)`);
}

/**
 * セクションの中身を丸ごと置き換える（無ければ末尾に追加）。
 * セクション見出しの重複を防ぐため、置換してから無ければ追記する。
 * replace は関数形式で渡す（本文の $& 等が置換パターンとして解釈されるのを防ぐ）。
 */
function upsertSectionInContent (content, title, body) {
  const re = buildSectionRegex(title);
  const block = body.endsWith('\n') ? body : body + '\n';
  if (re.test(content)) return content.replace(re, () => `## ${title}\n${block}`);
  return content.trimEnd() + `\n\n## ${title}\n${block}`;
}

/**
 * セクション末尾に1行だけ足す（既存の行は保持＝蓄積する）。
 * 感情ログのように upsert ではなく積み上げたい用途向け。
 */
function appendLineToSectionInContent (content, title, line) {
  const re = buildSectionRegex(title);
  const m = content.match(re);
  if (!m) return content.trimEnd() + `\n\n## ${title}\n${line}\n`;
  const existing = m[0].replace(/\s+$/, '');
  return content.replace(re, () => `${existing}\n${line}\n`);
}

/** セクションの本文だけを取り出す（見出し行を除く） */
function extractSectionBody (content, title) {
  const m = (content || '').match(buildSectionRegex(title));
  if (!m) return '';
  return m[0].split('\n').slice(1).join('\n').trim();
}

/**
 * AIによる振り返りを生成し、確認なしで日記へ upsert 保存する
 *
 * Kolb 4段階・ルーブリック数値化は採用しない（過去に4段構造そのものが負担で定着しなかった）。
 * ラベル分けしない自然な短文を1本生成し、`## AI振り返り（YYYY-MM-DD）` へ保存する。
 */
async function requestAiReflection() {
  const btn = document.getElementById('ai-reflection-btn');
  const statusEl = document.getElementById('reflect-status');
  if (!btn) return;

  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = '🤔 思考中...';
  if (statusEl) statusEl.textContent = 'AIが内容を分析しています...';

  try {
    // 日記が未取得のまま保存すると空で上書きしてしまうため、先に読み込む
    if (!reportContent) {
      const diary = await DiaryService.getTodayDiary();
      reportContent = diary.content;
      reportSha = diary.sha;
      reportPath = diary.path;
    }

    const today      = getJstTodayISO();
    const note       = (document.getElementById('reflect-note')?.value || '').trim();
    const emotionLog = extractSectionBody(reportContent, `感情ログ（${today}）`);

    const prompt = `以下は本日の日記です。内容を踏まえて振り返りの短文を書いてください。

## 制約
- 3〜5文の自然な文章にしてください。
- 見出し・箇条書き・「経験」「学び」などのラベル分けは使わないでください。
- 段階評価やスコアリングはしないでください。
- 日本語で、下記の人格設定の口調を守ってください。

人格設定：${getAiPrompt()}

## 本日の日記
${reportContent}

## 感情ログ
${emotionLog || '（記録なし）'}

## 本人の一言メモ
${note || '（なし）'}`;

    const aiComment = (await callGemini(prompt)).trim();
    if (!aiComment) throw new Error('AIから空の応答が返りました');

    // 一言メモは入力された場合のみ併記する
    const body = note ? `${aiComment}\n\n**今日の感想**: ${note}` : aiComment;
    reportContent = upsertSectionInContent(reportContent, `AI振り返り（${today}）`, body);

    renderCurrentTab();

    // 確認なしで自動保存する
    if (statusEl) statusEl.textContent = '💾 日記に保存中…';
    const result = await DiaryService.saveDiary(reportContent, reportSha);
    if (result && result.content && result.content.sha) reportSha = result.content.sha;
    localStorage.removeItem('diary-draft');

    const outputEl = document.getElementById('reflect-output');
    const resultEl = document.getElementById('reflect-ai-result');
    if (outputEl && resultEl) {
      outputEl.classList.remove('is-hidden');
      resultEl.innerHTML = renderMarkdown(body);
    }
    const noteEl = document.getElementById('reflect-note');
    if (noteEl) noteEl.value = '';

    if (statusEl) statusEl.textContent = `✅ 「AI振り返り（${today}）」に保存しました`;
  } catch (e) {
    console.error('AI Reflection Error:', e);
    if (statusEl) statusEl.textContent = `❌ エラー: ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
  }
}

// =====================
// 感情ログ
// =====================
// 日単位の単一 mood タグではなく、出来事に紐づく複数エントリとして蓄積する。
// upsert ではなく追記なので、1日に何度でも記録できる。画像・写真は対象外。
const EMOTION_TAGS = ['嬉しい', '楽しい', '安心', '誇らしい', '手応え', '不安', '焦り', '苛立ち', '疲れ', '落胆', '混乱'];

function renderEmotionTagOptions () {
  const sel = document.getElementById('emotion-tag');
  if (!sel || sel.options.length > 0) return;
  EMOTION_TAGS.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    sel.appendChild(opt);
  });
}

async function submitEmotionLog () {
  const eventEl     = document.getElementById('emotion-event');
  const tagEl       = document.getElementById('emotion-tag');
  const freeEl      = document.getElementById('emotion-tag-free');
  const intensityEl = document.getElementById('emotion-intensity');
  const statusEl    = document.getElementById('emotion-status');
  const btn         = document.getElementById('emotion-submit-btn');
  if (!eventEl) return;

  const setStatus = (msg, color) => {
    if (!statusEl) return;
    statusEl.style.color = color || 'var(--text-sub)';
    statusEl.textContent = msg;
  };

  const eventText = eventEl.value.trim();
  // 自由記述があればそれを優先し、無ければ固定語彙の選択値を使う
  const tag       = ((freeEl && freeEl.value.trim()) || (tagEl && tagEl.value) || '').trim();
  const intensity = Math.min(5, Math.max(1, parseInt((intensityEl && intensityEl.value) || '3', 10) || 3));

  if (!eventText) { setStatus('出来事を入力してください', '#cf222e'); return; }
  if (!tag)       { setStatus('感情を選択または入力してください', '#cf222e'); return; }

  if (btn) btn.disabled = true;
  setStatus('💾 保存中…');

  try {
    if (!reportContent) {
      const diary = await DiaryService.getTodayDiary();
      reportContent = diary.content;
      reportSha     = diary.sha;
      reportPath    = diary.path;
    }

    const today = getJstTodayISO();
    const now   = new Date().toLocaleTimeString('ja-JP', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo'
    });
    const line = `- ${now} ${eventText} → ${tag}（強度${intensity}/5）`;

    reportContent = appendLineToSectionInContent(reportContent, `感情ログ（${today}）`, line);
    renderCurrentTab();

    const result = await DiaryService.saveDiary(reportContent, reportSha);
    if (result && result.content && result.content.sha) reportSha = result.content.sha;
    localStorage.removeItem('diary-draft');

    eventEl.value = '';
    if (freeEl) freeEl.value = '';
    setStatus('✅ 記録しました', '#1a7f37');
    setTimeout(() => setStatus(''), 3000);
  } catch (e) {
    console.error('Emotion Log Error:', e);
    setStatus(`❌ エラー: ${e.message}`, '#cf222e');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// --- 自動保存・下書き復元・ライブプレビュー ---
document.addEventListener('DOMContentLoaded', () => {
  const textarea = document.getElementById('report-textarea');
  if (!textarea) return;

  // 下書き復元（初期表示時）
  const draft = localStorage.getItem('diary-draft');
  if (draft !== null) textarea.value = draft;

  // 入力時に自動保存＆ライブプレビュー
  textarea.addEventListener('input', () => {
    localStorage.setItem('diary-draft', textarea.value);
    // プレビュータブにも即時反映
    if (reportTab === 'preview') {
      document.getElementById('report-preview').innerHTML = renderMarkdown(textarea.value);
      attachMdCheckboxListeners();
    }
  });
});

// 保存時に下書きを消す
const origSaveDailyReport = saveDailyReport;
saveDailyReport = async function () {
  const textarea = document.getElementById('report-textarea');
  if (textarea) localStorage.removeItem('diary-draft');
  await origSaveDailyReport.apply(this, arguments);
};

function attachMdCheckboxListeners () {
  document.querySelectorAll('.md-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const lineIdx = parseInt(cb.dataset.line);
      const lines = reportContent.split('\n');
      if (!lines[lineIdx]) return;

      lines[lineIdx] = cb.checked
        ? lines[lineIdx].replace(/^(\s*)- \[ \]/, '$1- [x]')
        : lines[lineIdx].replace(/^(\s*)- \[x\]/i, '$1- [ ]');
      reportContent = lines.join('\n');

      const span = cb.nextElementSibling;
      if (span) span.classList.toggle('md-done', cb.checked);

      const saveEl = document.getElementById('save-status');
      if (saveEl) {
        saveEl.style.color = '#8e8e8e';
        saveEl.textContent = '未反映の変更があります（📋 振り返りで反映 / 保存）';
      }
      const metaEl = document.getElementById('report-meta');
      if (metaEl) {
        metaEl.textContent = 'ローカル変更あり（未反映）';
      }
    });
  });
}

async function saveDailyReport () {
  const newContent = document.getElementById('report-textarea').value;
  reportContent = newContent;
  const statusEl = document.getElementById('save-status');
  statusEl.style.color = '#888';
  statusEl.textContent = '保存中…';
  await pushReportToGitHub('✏️ 日記を編集');
}

async function pushReportToGitHub (message) {
  const token = getToken();
  if (!token) return;

  const saveEl = document.getElementById('save-status');
  const metaEl = document.getElementById('report-meta');

  try {
    const today = getJstTodayISO();
    const result = await DiaryService.saveDiary(reportContent, reportSha);
    
    reportSha = result.sha;
    renderCurrentTab();
    
    if (saveEl) { saveEl.style.color = '#1a7f37'; saveEl.textContent = '✅ 保存しました'; }
    const now = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    metaEl.textContent = `保存完了 ${now}（git pull で同期）`;
  } catch (e) {
    if (saveEl) { saveEl.style.color = '#cf222e'; saveEl.textContent = `保存失敗: ${e.message}`; }
  }
}

// デイリーチェックリスト「今日の四つ」と「日記に反映」（appendListToReport）は 2026-08-19 に機能ごと削除。

async function regenReport () {
  const token = getToken();
  if (!token) { alert('設定画面からアクセスキーを入力してください'); return; }

  const btn = document.getElementById('regen-btn');
  const statusEl = document.getElementById('regen-status');
  btn.disabled = true;
  statusEl.style.removeProperty('display');
  statusEl.classList.remove('is-hidden');
  statusEl.textContent = '生成中…';

  try {
    const today = getJstTodayISO();
    const template = await DiaryService.generateTemplate(today);
    
    await DiaryService.saveDiary(template, reportSha);
    
    await fetchDailyReport();
    switchTab('edit');
    statusEl.style.color = '#1a7f37';
    statusEl.textContent = '✅ テンプレートを生成しました';
    setTimeout(() => { statusEl.classList.add('is-hidden'); }, 3000);
  } catch (e) {
    statusEl.style.color = '#cf222e';
    statusEl.textContent = '生成エラー: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

window.switchMainTab = switchMainTab;
window.switchTab = switchTab;
window.renderReportHeading = renderReportHeading;
window.saveDailyReport = saveDailyReport;
window.regenReport = regenReport;
window.requestAiReflection = requestAiReflection;
window.fetchDailyReport = fetchDailyReport;
window.submitEmotionLog = submitEmotionLog;
window.upsertSectionInContent = upsertSectionInContent;
window.appendLineToSectionInContent = appendLineToSectionInContent;
window.extractSectionBody = extractSectionBody;

/**
 * AI チャットのツールが今日の日記へ書き込んだら、開いている日記画面へ即反映する
 * （tool-dispatcher.js の notifyVaultWrite が発火 / 2026-08-19）。
 * 未保存のローカル編集（diary-draft）があるときは上書きせず、更新がある旨だけ知らせる。
 */
window.addEventListener('vault-file-written', e => {
  const path = e.detail && e.detail.path;
  if (path !== getDailyReportPaths()[0]) return;

  if (localStorage.getItem('diary-draft') !== null) {
    const metaEl = document.getElementById('report-meta');
    if (metaEl) metaEl.textContent = 'AIが日記を更新しました（未保存の編集があるため「更新」で読込）';
    return;
  }
  fetchDailyReport();
});

/** 振り返りカードのアイコンを使用中ペルソナの立ち絵に合わせる */
function applyReflectAvatar() {
  const img = document.getElementById('reflect-avatar');
  if (img && typeof getAiAvatar === 'function') img.src = getAiAvatar();
}
window.addEventListener('persona-loaded', applyReflectAvatar);

// このスクリプトは panel-report.html の末尾で実行されるため、パネル内の要素は既に存在する
// （html-loader は innerHTML 挿入後に script を実行する）
renderEmotionTagOptions();
applyReflectAvatar();   // persona-loaded を取りこぼした場合の保険
