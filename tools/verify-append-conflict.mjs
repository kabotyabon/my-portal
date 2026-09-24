/**
 * 会話ログの発話が消えた lost update を、本物の saveFile() / _appendToFile() で再現・検証する。
 * 通信部分だけ GitHub の挙動を模したスタブに差し替える。
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const APP = new URL('../portal-app/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// ---------- 疑似 GitHub ----------
function makeGitHub() {
  const files = new Map(); // path -> content
  const sha = c => createHash('sha1').update('blob ' + Buffer.byteLength(c) + '\0' + c).digest('hex');
  return {
    files,
    get(path) { return files.has(path) ? { content: files.get(path), sha: sha(files.get(path)) } : null; },
    put(path, content, incomingSha) {
      const cur = files.get(path);
      if (cur === undefined) {
        if (incomingSha) return { status: 409, message: 'does not match' };
      } else {
        if (!incomingSha) return { status: 422, message: 'sha wasn\'t supplied' };
        if (incomingSha !== sha(cur)) return { status: 409, message: 'does not match' };
      }
      files.set(path, content);
      return { status: 200, body: { content: { sha: sha(content) }, commit: { sha: 'c' + files.size } } };
    },
  };
}

// ---------- 1端末ぶんの実行環境 ----------
function makeDevice(gh, log) {
  const store = new Map();
  const ctx = {
    console,
    setTimeout,
    TextDecoder,
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    Date,
    JSON, Math, Promise, Object, Array, String, Error, Number,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    addEventListener: () => {},
    getToken: () => 'tok', getRepo: () => 'o/r', getBranch: () => 'main',
    getJstTodayISO: () => '2026-08-06',
    encodeUtf8Base64: s => Buffer.from(s, 'utf8').toString('base64'),
    fetch: async (url, init = {}) => {
      const m = String(url).match(/contents\/(.+?)(\?|$)/);
      const path = decodeURIComponent(m[1]).split('/').map(decodeURIComponent).join('/');
      if (!init.method || init.method === 'GET') {
        const f = gh.get(path);
        if (!f) return { ok: false, status: 404, json: async () => ({}) };
        return {
          ok: true, status: 200,
          json: async () => ({ content: Buffer.from(f.content, 'utf8').toString('base64'), sha: f.sha, path }),
        };
      }
      const body = JSON.parse(init.body);
      const r = gh.put(path, Buffer.from(body.content, 'base64').toString('utf8'), body.sha);
      log.push(`PUT ${path} sha=${(body.sha || 'none').slice(0, 7)} -> ${r.status}`);
      if (r.status !== 200) return { ok: false, status: r.status, json: async () => ({ message: r.message }) };
      return { ok: true, status: 200, json: async () => r.body };
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['js/storage/github-storage.js', 'js/domains/conversation-log.js']) {
    vm.runInContext(readFileSync(`${APP}/${f}`, 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

const entry = (role, speaker, text, at) => ({ role, speaker, text, at, feedback: role === 'user' ? 'free' : undefined });

// ================= シナリオ: 2端末がインターリーブする =================
async function run() {
  const gh = makeGitHub();
  const log = [];
  const path = 'vault/conversations/2026-08-06_アバター会話.md';
  gh.files.set(path, '# 2026-08-06 アバター会話ログ\n');

  const A = makeDevice(gh, log);
  const B = makeDevice(gh, log);

  // 両端末が「同じ中身」を読んだ状態を作るため、read を先に済ませてから書かせる。
  // _appendToFile は read→write を内部で行うので、fetch を差し込んで順序を制御する。
  const origFetchB = B.fetch;
  let bReadDone;
  const bReadGate = new Promise(r => (bReadDone = r));
  let aWriteDone;
  const aWriteGate = new Promise(r => (aWriteDone = r));

  B.fetch = async (url, init = {}) => {
    if (!init.method || init.method === 'GET') {
      const res = await origFetchB(url, init);
      bReadDone();          // B が読んだ
      await aWriteGate;     // A が書き終わるのを待つ（＝古い写しを持ったまま書きに行く）
      return res;
    }
    return origFetchB(url, init);
  };

  const pB = B.ConversationLog._appendToFile('2026-08-06', [entry('user', 'ユーザー', '端末Bの発話', '10:01')]);
  await bReadGate;
  await A.ConversationLog._appendToFile('2026-08-06', [entry('user', 'ユーザー', '端末Aの発話', '10:00')]);
  aWriteDone();
  await pB;

  const final = gh.files.get(path);
  console.log('--- PUT ログ ---');
  log.forEach(l => console.log('  ' + l));
  console.log('\n--- 最終的なファイル内容 ---');
  console.log(final.split('\n').map(l => '  ' + l).join('\n'));

  const hasA = final.includes('端末Aの発話');
  const hasB = final.includes('端末Bの発話');
  console.log('\n--- 判定 ---');
  console.log(`  端末Aの発話: ${hasA ? '残っている' : '★消えた'}`);
  console.log(`  端末Bの発話: ${hasB ? '残っている' : '★消えた'}`);
  console.log(`  結果: ${hasA && hasB ? 'PASS（両方残った）' : 'FAIL（取りこぼしあり）'}`);
  return hasA && hasB;
}

// ================= 既定挙動（baseSha なし）が壊れていないか =================
async function runDefault() {
  const gh = makeGitHub();
  const log = [];
  const D = makeDevice(gh, log);
  const p = 'vault/diary/2026-08-06.md';

  const r1 = await D.GitHubStorage.saveFile(p, '# 新規\n', 'create');       // 新規作成
  const r2 = await D.GitHubStorage.saveFile(p, '# 新規\n更新\n', 'update'); // 既存更新
  const ok = gh.files.get(p) === '# 新規\n更新\n' && r1.previousSha === '' && !!r2.previousSha;
  console.log('\n--- 既定挙動（日記・設定・タスクが通る経路） ---');
  log.forEach(l => console.log('  ' + l));
  console.log(`  結果: ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

// ========== 対照実験: 旧実装（baseSha を渡さない）なら本当に消えるか ==========
// テストが不具合を検出できることの確認。ここが PASS してしまうならテストが無意味。
async function runOldBehaviour() {
  const gh = makeGitHub();
  const log = [];
  const path = 'vault/conversations/2026-08-06_アバター会話.md';
  gh.files.set(path, '# 2026-08-06 アバター会話ログ\n');

  const A = makeDevice(gh, log);
  const B = makeDevice(gh, log);

  // 旧 _appendToFile 相当: read → 組み立て → baseSha 無しで saveFile
  const oldAppend = async (dev, text) => {
    const existing = await dev.GitHubStorage.getFile(path).catch(() => null);
    const body = existing ? existing.content.replace(/\s*$/, '') : '# log';
    return { commit: async () => dev.GitHubStorage.saveFile(path, `${body}\n\n${text}\n`, 'append') };
  };

  const pendingB = await oldAppend(B, '端末Bの発話'); // B が読む
  const pendingA = await oldAppend(A, '端末Aの発話'); // A が読む（同じ中身）
  await pendingA.commit();
  await pendingB.commit(); // 古い写しのまま書く

  const final = gh.files.get(path);
  const hasA = final.includes('端末Aの発話');
  const hasB = final.includes('端末Bの発話');
  console.log('\n--- 対照実験: 旧実装（baseSha なし） ---');
  log.forEach(l => console.log('  ' + l));
  console.log(`  端末Aの発話: ${hasA ? '残っている' : '★消えた'}`);
  console.log(`  端末Bの発話: ${hasB ? '残っている' : '★消えた'}`);
  const reproduced = !(hasA && hasB);
  console.log(`  結果: ${reproduced ? 'OK（不具合を再現＝テストは有効）' : 'NG（再現しない＝テストが無意味）'}`);
  return reproduced;
}

const a = await run();
const b = await runDefault();
const c = await runOldBehaviour();
console.log(`\n===== 総合: ${a && b && c ? 'PASS' : 'FAIL'} =====`);
process.exit(a && b && c ? 0 : 1);

