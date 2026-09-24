/**
 * Persistence Layer: GitHub Storage (中間サーバー経由)
 * 依存関係: js/ui/settings.js (getToken), js/core/utils.js (encodeUtf8Base64)
 *
 * my-portal-vault への読み書きは、Cloudflare Workers の中間サーバー
 * （worker-proxy/、api.knowledgenote.work）を経由する。GitHub PATはWorker側の
 * Secretにのみ存在し、ブラウザは一切持たない。ここで持つのは PORTAL_API_KEY と
 * 同じ値の「アクセスキー」（settings.js の getToken()）だけ。
 * リポジトリ・ブランチはWorker側の環境変数で固定されているため、クライアント側の
 * 設定（旧 portal-config.json / getRepo・getBranch）は不要になった。
 */

const PROXY_BASE = 'https://api.knowledgenote.work';

class GitHubAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GitHubAuthError';
  }
}
window.GitHubAuthError = GitHubAuthError;

/**
 * 楽観的ロックの照合に失敗した（＝読んでから書くまでの間に他所で更新された）。
 * `saveFile()` に `baseSha` を渡したときだけ投げる。
 * 呼び出し側は「読み直して組み立て直す」ことが期待されている。
 * 黙ってリトライしてはいけない——それをやったのが過去に会話ログの発話を消した不具合の正体。
 */
class GitHubConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GitHubConflictError';
  }
}
window.GitHubConflictError = GitHubConflictError;

window.GitHubStorage = {
  /**
   * 認証情報を取り出す。全メソッドの入口で使う。
   *
   * アクセスキーは X-Portal-Key ヘッダに載せるため、ISO-8859-1 の範囲外の文字が
   * 1つでもあると fetch が `String contains non ISO-8859-1 code point` という
   * TypeError を投げる。呼び出し箇所から遠いところで出るので、ここで原因の分かる形にする。
   *
   * @returns {{key: string}}
   */
  _requireAuth() {
    const key = getToken();
    if (!key) throw new Error('アクセスキーが設定されていません');
    if (/[^\x21-\x7E]/.test(key)) {
      throw new GitHubAuthError(
        'アクセスキーに使用できない文字が含まれています（全角文字や空白など）。'
        + '設定から「アクセスキーを削除」して、入力し直してください。'
      );
    }
    return { key };
  },

  _contentsUrl(path) {
    const encPath = path.split('/').map(encodeURIComponent).join('/');
    return `${PROXY_BASE}/api/vault/contents/${encPath}`;
  },

  /**
   * ファイルの内容を取得する
   * @param {string} path - リポジトリ内のパス
   * @returns {Promise<{content: string, sha: string, path: string} | null>}
   */
  async getFile(path) {
    const { key } = this._requireAuth();

    // 中間サーバー側で Cache-Control: no-store を付与しているため、
    // 書き込み直後の再取得でも古い内容を掴まない。
    const res = await fetch(this._contentsUrl(path), {
      cache: 'no-store',
      headers: {
        'X-Portal-Key': key,
        Accept: 'application/json'
      }
    });

    if (!res.ok) {
      if (res.status === 404) return null;
      const err = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        throw new GitHubAuthError(err.message || `HTTP ${res.status}`);
      }
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const raw = atob(data.content.replace(/\n/g, ''));
    const content = new TextDecoder('utf-8').decode(Uint8Array.from(raw, c => c.charCodeAt(0)));

    return {
      content,
      sha: data.sha,
      path: data.path
    };
  },

  /**
   * ファイルを保存（作成・更新）する
   *
   * 既定では、書き込み直前に最新 SHA を取り直して送る（＝必ず通る上書き）。
   * `opts.baseSha` を渡すと**楽観的ロック**になり、読んだ時点から中身が変わっていれば
   * GitHub が拒否し、`GitHubConflictError` を投げる。
   *
   * @param {string} path - 保存先のパス
   * @param {string} content - 内容
   * @param {string} message - コミットメッセージ
   * @param {{baseSha?: string|null}} [opts] - `baseSha` を渡すと楽観的ロックで書き込む。
   *   新規作成のつもりなら `null` を渡す（既に存在していれば衝突として扱われる）。
   * @returns {Promise<Object>} APIレスポンス（`previousSha` 付き）
   * @throws {GitHubConflictError} `baseSha` 指定時に照合が失敗した場合
   */
  async saveFile(path, content, message = 'Update file via Portal', opts = {}) {
    const { key } = this._requireAuth();

    const url = this._contentsUrl(path);
    const encodedContent = encodeUtf8Base64(content);
    const useBaseSha = Object.prototype.hasOwnProperty.call(opts, 'baseSha');

    const attemptSave = async () => {
      let sha;
      if (useBaseSha) {
        // 呼び出し側が「読んだときの SHA」を持っている。取り直さない。
        // 取り直すと照合が必ず通ってしまい、古い内容で静かに上書きしてしまう。
        sha = opts.baseSha || undefined;
      } else {
        // 既定の挙動: 毎回最新の SHA を取得（リトライ時も含む）
        try {
          const existing = await this.getFile(path);
          if (existing) sha = existing.sha;
        } catch (e) { /* 新規作成 */ }
      }

      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'X-Portal-Key': key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message,
          content: encodedContent,
          ...(sha ? { sha } : {})
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 401 || res.status === 403) throw new GitHubAuthError(err.message || `HTTP ${res.status}`);
        const error = new Error(err.message || `HTTP ${res.status}`);
        error.status = res.status;
        throw error;
      }
      // 書き込み前の SHA を添えて返す。
      // GitHub は内容が同一でも 200 と commit を返す（＝空コミットができる）ため、
      // 「commit が返ったか」だけでは中身が変わったか判別できない。
      // blob の SHA は内容が同じなら変わらないので、呼び出し側はこれと突き合わせる。
      const json = await res.json();
      return { ...json, previousSha: sha || '' };
    };

    if (useBaseSha) {
      // 楽観的ロック: 衝突は呼び出し側に返す。ここでリトライしてはいけない。
      // 422 は「sha 未指定なのに既存ファイルがある」＝他所で作られた場合も含むため衝突として扱う。
      try {
        return await attemptSave();
      } catch (e) {
        if (e.status === 409 || e.status === 422) {
          const conflict = new GitHubConflictError(
            `保存先が読み込み後に更新されています（${path}）: ${e.message}`
          );
          conflict.status = e.status;
          throw conflict;
        }
        throw e;
      }
    }

    try {
      return await attemptSave();
    } catch (e) {
      // SHA 不一致（409/422）の場合は最新 SHA で1回リトライ
      if (e.status === 409 || e.status === 422) {
        console.warn('SHA 不一致のためリトライします:', e.message);
        return await attemptSave();
      }
      throw e;
    }
  },

  /**
   * ファイルを削除する（日記の月次まとめで日別ファイルを畳むときに使う）
   * @param {string} path - 削除対象のパス
   * @param {string} message - コミットメッセージ
   * @returns {Promise<boolean>} 削除したら true、存在しなければ false
   */
  async deleteFile(path, message = 'Delete file via Portal') {
    const { key } = this._requireAuth();

    const existing = await this.getFile(path);
    if (!existing) return false;

    const res = await fetch(this._contentsUrl(path), {
      method: 'DELETE',
      headers: {
        'X-Portal-Key': key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message, sha: existing.sha })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) throw new GitHubAuthError(err.message || `HTTP ${res.status}`);
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    return true;
  },

  /**
   * ディレクトリ内のファイル一覧を取得する
   * @param {string} directory - ディレクトリパス
   * @returns {Promise<Array>}
   */
  async listFiles(directory) {
    const { key } = this._requireAuth();

    const res = await fetch(this._contentsUrl(directory), {
      cache: 'no-store',   // getFile と同じ理由（古い一覧を掴まない）
      headers: {
        'X-Portal-Key': key,
        Accept: 'application/json'
      }
    });

    if (!res.ok) {
      if (res.status === 404) return [];
      if (res.status === 401 || res.status === 403) {
        const err = await res.json().catch(() => ({}));
        throw new GitHubAuthError(err.message || `HTTP ${res.status}`);
      }
      throw new Error(`HTTP ${res.status}`);
    }

    return await res.json();
  }
};
