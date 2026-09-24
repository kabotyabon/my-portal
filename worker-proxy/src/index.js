/**
 * my-portal-vault-proxy
 *
 * my-portal-vault（GitHub Contents API）への読み書きを中継するだけの薄いプロキシ。
 * GitHub PAT はここ（Cloudflare Workers の Secret）にだけ置き、アプリ側（Web/モバイル）は
 * 一切PATを持たない。詳細は vault/knowledge/Cloudflare_Workersと中間サーバー学習ノート.md を参照。
 *
 * 認証は2段構え:
 *   - クライアント → この Worker: X-Portal-Key ヘッダー（PORTAL_API_KEY と照合。GitHub PATとは無関係）
 *   - この Worker → GitHub: Authorization ヘッダー（GITHUB_PAT。クライアントには渡さない）
 *
 * 必須の環境変数・Secret（wrangler.toml の [vars] と `wrangler secret put`）:
 *   GITHUB_REPO      (vars)   例: "kabotyabon/my-portal-vault"
 *   GITHUB_BRANCH    (vars)   例: "main"
 *   ALLOWED_ORIGINS  (vars)   例: "https://kabotyabon.github.io,https://knowledgenote.work"
 *   GITHUB_PAT       (secret) my-portal-vault への Contents:write / Actions:write を持つ PAT
 *   PORTAL_API_KEY   (secret) アプリ⇄Worker間の合言葉（openssl rand -hex 32 等で生成）
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = buildCorsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // secret put はCLIの入力経路によって末尾に改行が混入しうるため、両辺をtrimして比較する
    const key = (request.headers.get('X-Portal-Key') || '').trim();
    const expected = (env.PORTAL_API_KEY || '').trim();
    if (!expected || key !== expected) {
      return json({ message: '認証に失敗しました（X-Portal-Key が不正です）' }, 401, corsHeaders);
    }

    try {
      const path = url.pathname;

      if (path.startsWith('/api/vault/contents/')) {
        const filePath = decodeURIComponent(path.slice('/api/vault/contents/'.length));
        return await handleContents(request, env, filePath, url.searchParams, corsHeaders);
      }

      if (path === '/api/vault/dispatch/daily-report' && request.method === 'POST') {
        return await handleDispatch(request, env, corsHeaders);
      }

      return json({ message: 'Not found' }, 404, corsHeaders);
    } catch (e) {
      return json({ message: e.message || 'Internal error' }, 500, corsHeaders);
    }
  }
};

function buildCorsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const corsOrigin = allowed.includes(origin) ? origin : (allowed[0] || '');
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Portal-Key',
    'Vary': 'Origin'
  };
}

function json(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

function githubHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_PAT}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'my-portal-vault-proxy'
  };
}

/**
 * GET    /api/vault/contents/<path>?ref=<branch>   … ファイル取得 / ディレクトリ一覧（GitHub側の仕様に準拠）
 * PUT    /api/vault/contents/<path>                … 作成・更新（body: {content, message, branch?, sha?}）
 * DELETE /api/vault/contents/<path>                … 削除（body: {message, sha, branch?}）
 * いずれもGitHub Contents APIのレスポンスをそのまま透過する。
 */
async function handleContents(request, env, filePath, searchParams, corsHeaders) {
  const encPath = filePath.split('/').map(encodeURIComponent).join('/');
  const branch = searchParams.get('ref') || env.GITHUB_BRANCH || 'main';
  const githubUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${encPath}`;

  if (request.method === 'GET') {
    const res = await fetch(`${githubUrl}?ref=${encodeURIComponent(branch)}`, {
      headers: githubHeaders(env),
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders }
    });
  }

  if (request.method === 'PUT') {
    const payload = await request.json();
    const res = await fetch(githubUrl, {
      method: 'PUT',
      headers: { ...githubHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: payload.message || 'Update file via Portal',
        content: payload.content,
        branch: payload.branch || branch,
        ...(payload.sha ? { sha: payload.sha } : {})
      })
    });
    const body = await res.text();
    return new Response(body, { status: res.status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }

  if (request.method === 'DELETE') {
    const payload = await request.json();
    const res = await fetch(githubUrl, {
      method: 'DELETE',
      headers: { ...githubHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: payload.message || 'Delete file via Portal',
        sha: payload.sha,
        branch: payload.branch || branch
      })
    });
    const body = await res.text();
    return new Response(body, { status: res.status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }

  return json({ message: 'Method not allowed' }, 405, corsHeaders);
}

/** POST /api/vault/dispatch/daily-report … 日報ワークフローを workflow_dispatch で起動する */
async function handleDispatch(request, env, corsHeaders) {
  const payload = await request.json().catch(() => ({}));
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/daily-report.yml/dispatches`,
    {
      method: 'POST',
      headers: { ...githubHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: payload.ref || env.GITHUB_BRANCH || 'main' })
    }
  );
  if (res.status === 204) return new Response(null, { status: 204, headers: corsHeaders });
  const body = await res.text();
  return new Response(body, { status: res.status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}
