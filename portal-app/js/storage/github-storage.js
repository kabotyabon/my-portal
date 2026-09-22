/**
 * Persistence Layer: GitHub API Storage
 * 依存関係: js/config.js (getRepo, getBranch), js/settings.js (getToken), js/utils.js (encodeUtf8Base64)
 */

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
   * PAT は Authorization ヘッダに載せるため、ISO-8859-1 の範囲外の文字が
   * 1つでもあると fetch が `String contains non ISO-8859-1 code point` という
   * TypeError を投げる。呼び出し箇所から遠いところで出るうえ、
   * リポジトリ設定の問題と見分けがつかないので、ここで原因の分かる形にする。
   * （実際にトークン欄へ別のテキストを貼ってしまい、全 API が落ちる事故が起きた）
   *
   * @returns {{token: string, repo: string}}
   */
  _requireAuth() {
    const token = getToken();
    const repo = getRepo();
    if (!token || !repo) throw new Error('GitHub PAT またはリポジトリが設定されていません');
    if (/[^\x21-\x7E]/.test(token)) {
      throw new GitHubAuthError(
        'GitHub PAT に使用できない文字が含まれています（全角文字や空白など）。'
        + '設定から「トークンを削除」して、入力し直してください。'
      );
    }
    return { token, repo };
  },

  /**
   * ファイルの内容を取得する
   * @param {string} path - リポジトリ内のパス
   * @returns {Promise<{content: string, sha: string, path: string} | null>}
   */
  async getFile(path) {
    const { token, repo } = this._requireAuth();

    const encPath = path.split('/').map(encodeURIComponent).join('/');
    // GitHub API は Cache-Control: max-age=60 を返すため、既定の fetch だと
    // 書き込み直後の再取得が最大60秒古い内容を返す（「更新を押しても反映されない」の原因）。
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${encPath}?ref=${getBranch()}`, {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json'
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
    const { token, repo } = this._requireAuth();

    const encPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `https://api.github.com/repos/${repo}/contents/${encPath}`;
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
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message,
          content: encodedContent,
          branch: getBranch(),
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
    const { token, repo } = this._requireAuth();

    const existing = await this.getFile(path);
    if (!existing) return false;

    const encPath = path.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${encPath}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message, sha: existing.sha, branch: getBranch() })
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
    const { token, repo } = this._requireAuth();

    const encPath = directory.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${encPath}?ref=${getBranch()}`, {
      cache: 'no-store',   // getFile と同じ理由（max-age=60 の古い一覧を掴まない）
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json'
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
