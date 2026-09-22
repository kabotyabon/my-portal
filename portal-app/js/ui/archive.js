/**
 * 日記アーカイブ／ナレッジ閲覧パネル
 *
 * vault/diary・vault/knowledge のファイル一覧を出し、クリックで開いて編集・保存する。
 * 表示中のディレクトリへの新規ファイル追加もここで行う。
 * 編集・保存の実体は js/ui/file-editor.js の汎用コンポーネント。
 */

const ARCHIVE_ROOTS = [
  { key: 'diary',     label: '📔 日記',     path: 'vault/diary' },
  { key: 'knowledge', label: '📚 ナレッジ', path: 'vault/knowledge' },
  // ユーザー像と観察ログ。プロンプトに載る内容なので、目で見て直せる場所が要る
  { key: 'persona',   label: '🧠 記憶',     path: 'vault/persona-state' }
];

let archiveEditor  = null;
let archiveRootKey = 'diary';
let archiveCurDir  = 'vault/diary';

function getArchiveRoot() {
  return ARCHIVE_ROOTS.find(r => r.key === archiveRootKey) || ARCHIVE_ROOTS[0];
}

function initArchivePanel() {
  if (!archiveEditor) {
    archiveEditor = createFileEditor({
      wrapId:       'archive-editor-wrap',
      titleId:      'archive-file-title',
      previewId:    'archive-preview',
      editId:       'archive-edit',
      textareaId:   'archive-textarea',
      tabPreviewId: 'archive-tab-preview',
      tabEditId:    'archive-tab-edit',
      statusId:     'archive-status',
      saveMessage:  path => `✏️ ${path.split('/').pop()} を編集（Portal）`
    });
    window.archiveEditor = archiveEditor;
  }
  renderArchiveRootTabs();
  loadArchiveList(getArchiveRoot().path);
}

function setArchiveStatus(msg, color) {
  const el = document.getElementById('archive-status');
  if (!el) return;
  el.style.color = color || 'var(--text-sub)';
  el.textContent = msg;
}

function renderArchiveRootTabs() {
  const el = document.getElementById('archive-root-tabs');
  if (!el) return;
  el.innerHTML = ARCHIVE_ROOTS.map(r =>
    `<button class="report-tab${r.key === archiveRootKey ? ' active' : ''}" onclick="switchArchiveRoot('${r.key}')">${r.label}</button>`
  ).join('');
}

function switchArchiveRoot(key) {
  archiveRootKey = key;
  renderArchiveRootTabs();
  if (archiveEditor) archiveEditor.close();
  loadArchiveList(getArchiveRoot().path);
}

async function loadArchiveList(dirPath) {
  const listEl = document.getElementById('archive-list');
  if (!listEl) return;

  archiveCurDir = dirPath;
  renderArchiveAddRow();
  listEl.innerHTML = '<p style="font-size:0.78rem;color:var(--text-sub);">読み込み中…</p>';

  try {
    const entries = await GitHubStorage.listFiles(dirPath);

    // 年ディレクトリ（2026 など）は新しい年を上に、それ以外は名前昇順
    const isYearDir = name => /^\d{4}$/.test(name);
    const dirs = entries
      .filter(e => e.type === 'dir')
      .sort((a, b) => {
        if (isYearDir(a.name) && isYearDir(b.name)) return b.name.localeCompare(a.name);
        if (isYearDir(a.name)) return -1;
        if (isYearDir(b.name)) return 1;
        return a.name.localeCompare(b.name);
      });
    // 日付ファイル名を新しい順に並べたいので降順
    const files = entries
      .filter(e => e.type === 'file' && e.name.toLowerCase().endsWith('.md'))
      .sort((a, b) => b.name.localeCompare(a.name));

    // パスは data 属性で渡す（onclick に埋め込むとパス中の引用符で壊れるため）
    const rows = [];
    const rootPath = getArchiveRoot().path;
    if (dirPath !== rootPath) {
      const parent = dirPath.split('/').slice(0, -1).join('/');
      rows.push(`<button class="archive-item" data-kind="dir" data-path="${escapeHtml(parent)}">⬆️ 上へ</button>`);
    }
    dirs.forEach(d => {
      rows.push(`<button class="archive-item" data-kind="dir" data-path="${escapeHtml(d.path)}">📁 ${escapeHtml(d.name)}</button>`);
    });
    files.forEach(f => {
      rows.push(`<button class="archive-item" data-kind="file" data-path="${escapeHtml(f.path)}">📄 ${escapeHtml(f.name)}</button>`);
    });

    listEl.innerHTML = rows.length > 0
      ? rows.join('')
      : '<p style="font-size:0.78rem;color:var(--text-sub);">ファイルがありません</p>';

    if (!listEl.dataset.listenerAdded) {
      listEl.addEventListener('click', e => {
        const btn = e.target.closest('.archive-item');
        if (!btn) return;
        const path = btn.dataset.path;
        if (btn.dataset.kind === 'dir') loadArchiveList(path);
        else openArchiveFile(path);
      });
      listEl.dataset.listenerAdded = 'true';
    }

    const crumbEl = document.getElementById('archive-breadcrumb');
    if (crumbEl) crumbEl.textContent = dirPath;
  } catch (e) {
    console.error('loadArchiveList failed:', e);
    listEl.innerHTML = `<p style="font-size:0.78rem;color:#cf222e;">読み込み失敗: ${escapeHtml(e.message)}</p>`;
  }
}

/* ========== 新規ファイル追加 ========== */

/** 追加行のプレースホルダを、表示中のディレクトリに合わせて書き換える */
function renderArchiveAddRow() {
  const input = document.getElementById('archive-new-name');
  if (!input) return;
  const today = typeof getJstTodayISO === 'function'
    ? getJstTodayISO()
    : new Date().toISOString().slice(0, 10);
  input.placeholder = archiveRootKey === 'diary'
    ? `${archiveCurDir} に追加（例: ${today}）`
    : `${archiveCurDir} に追加（例: 抽象化）`;
}

/**
 * 入力されたファイル名を検証して正規化する。
 * サブディレクトリ付き（例: 2026/2026-08）も許すが、.. や絶対パスは弾く。
 * @returns {{name?: string, error?: string}}
 */
function normalizeArchiveName(raw) {
  let name = (raw || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!name) return { error: 'ファイル名を入力してください' };
  if (/[<>:"|?*]/.test(name) || Array.from(name).some(c => c.charCodeAt(0) < 0x20)) {
    return { error: '使えない文字が含まれています（< > : " | ? *）' };
  }
  const segments = name.split('/');
  if (segments.some(s => s === '' || s === '.' || s === '..')) {
    return { error: 'ファイル名に .. や空のディレクトリ名は使えません' };
  }
  if (!/\.md$/i.test(name)) name += '.md';
  return { name };
}

/**
 * 新規ファイルの雛形。日付・年月のファイル名は日記の見出し規約に合わせる。
 */
function archiveNewFileTemplate(name) {
  const base = name.replace(/\.md$/i, '').split('/').pop();
  if (/^\d{4}-\d{2}-\d{2}$/.test(base)) return `# ${base}\n\n`;
  const ym = base.match(/^(\d{4})-(\d{2})$/);
  if (ym) return `# ${Number(ym[1])}年${Number(ym[2])}月\n\n`;
  return `# ${base}\n\n`;
}

/** 表示中のディレクトリに新しい Markdown ファイルを作り、編集タブで開く */
async function createArchiveFile() {
  if (!archiveEditor) initArchivePanel();

  const input = document.getElementById('archive-new-name');
  if (!input) return;

  const { name, error } = normalizeArchiveName(input.value);
  if (error) {
    setArchiveStatus(error, '#cf222e');
    input.focus();
    return;
  }

  // 作成すると開いているファイルがエディタから外れるため、未保存があれば確認する
  if (archiveEditor && archiveEditor.dirty
      && !confirm('編集中の内容が未保存です。破棄して新規ファイルを作成しますか？')) return;

  const path = `${archiveCurDir}/${name}`;
  const btn = document.getElementById('archive-add-btn');
  if (btn) btn.disabled = true;
  setArchiveStatus('作成中…');

  try {
    // 既存ファイルを黙って上書きしない。同名があればそれを開くだけにする
    const existing = await GitHubStorage.getFile(path);
    if (existing) {
      input.value = '';
      await openArchiveFile(path);
      setArchiveStatus(`${path} はすでにあります（上書きせずに開きました）`, '#cf222e');
      return;
    }

    const body   = archiveNewFileTemplate(name);
    const result = await GitHubStorage.saveFile(path, body, `📄 ${name} を作成（Portal）`);
    input.value = '';
    input.blur();
    await loadArchiveList(archiveCurDir);
    // 作成直後は getFile が反映待ちで 404 を返すことがあるため、書き込んだ内容でそのまま開く
    archiveEditor.openWith(path, body, result?.content?.sha || '', 'edit');
    setArchiveStatus(`✅ ${path} を作成しました`, '#1a7f37');
  } catch (e) {
    console.error('createArchiveFile failed:', e);
    setArchiveStatus(`作成失敗: ${e.message}`, '#cf222e');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function openArchiveFile(path) {
  if (!archiveEditor) initArchivePanel();
  return await archiveEditor.open(path);
}

function switchArchiveTab(tab)  { if (archiveEditor) archiveEditor.switchTab(tab); }
function markArchiveDirty()     { if (archiveEditor) archiveEditor.markDirty(); }
async function saveArchiveFile(){ if (archiveEditor) await archiveEditor.save(); }
function closeArchiveFile()     { if (archiveEditor) archiveEditor.close(); }

window.initArchivePanel  = initArchivePanel;
window.switchArchiveRoot = switchArchiveRoot;
window.loadArchiveList   = loadArchiveList;
window.openArchiveFile   = openArchiveFile;
window.createArchiveFile = createArchiveFile;
window.switchArchiveTab  = switchArchiveTab;
window.markArchiveDirty  = markArchiveDirty;
window.saveArchiveFile   = saveArchiveFile;
window.closeArchiveFile  = closeArchiveFile;
