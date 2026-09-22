/**
 * Diary Repository (File-based)
 * 依存関係: js/storage/github-storage.js
 */

window.DiaryRepository = {
  /**
   * 指定した日付の日記を取得する
   * @param {string} dateISO - YYYY-MM-DD
   */
  async getDiary(dateISO) {
    const path = `vault/diary/${dateISO}.md`;
    try {
      const result = await GitHubStorage.getFile(path);
      if (!result) return null;
      return {
        path: path,
        content: result.content,
        sha: result.sha
      };
    } catch (e) {
      console.error(`Diary取得失敗 (${dateISO}):`, e);
      return null;
    }
  },

  /**
   * 日記を保存する
   * @param {string} dateISO - YYYY-MM-DD
   * @param {string} content - 内容
   * @param {string} sha - 既存ファイルのSHA
   */
  async saveDiary(dateISO, content, sha) {
    const path = `vault/diary/${dateISO}.md`;
    const message = sha ? `📝 日記更新: ${dateISO}` : `🆕 日記作成: ${dateISO}`;
    return await GitHubStorage.saveFile(path, content, message);
  },

  /** 月次まとめのパス（暦年ディレクトリ配下） */
  monthlyPath(yearMonth) {
    return `vault/diary/${yearMonth.slice(0, 4)}/${yearMonth}.md`;
  },

  /**
   * 日記エントリを新しい順に列挙する。
   * ルート直下の日別（当月）→ 年ディレクトリ内の月次まとめ、の順に必要な分だけ辿る。
   * 年ディレクトリは新しい年から順に、limit に達するまでしか開かない（API 呼び出しの節約）。
   *
   * @param {number} limit 取得したいエントリ数
   * @returns {Promise<Array<{name: string, path: string, key: string, kind: 'daily'|'monthly'}>>}
   */
  async listEntries(limit = 30) {
    const root = await GitHubStorage.listFiles('vault/diary');

    const daily = root
      .filter(e => e.type === 'file' && /^\d{4}-\d{2}-\d{2}\.md$/.test(e.name))
      .map(e => ({ name: e.name, path: e.path, key: e.name.replace('.md', ''), kind: 'daily' }))
      .sort((a, b) => b.key.localeCompare(a.key));

    // 移行前に残っているルート直下の月次まとめも拾う（後方互換）
    const rootMonthly = root
      .filter(e => e.type === 'file' && /^\d{4}-\d{2}\.md$/.test(e.name))
      .map(e => ({ name: e.name, path: e.path, key: e.name.replace('.md', ''), kind: 'monthly' }));

    const entries = [...daily, ...rootMonthly];

    const yearDirs = root
      .filter(e => e.type === 'dir' && /^\d{4}$/.test(e.name))
      .sort((a, b) => b.name.localeCompare(a.name));

    for (const dir of yearDirs) {
      if (entries.length >= limit) break;
      try {
        const inner = await GitHubStorage.listFiles(dir.path);
        inner
          .filter(e => e.type === 'file' && /^\d{4}-\d{2}\.md$/.test(e.name))
          .forEach(e => entries.push({
            name: e.name, path: e.path, key: e.name.replace('.md', ''), kind: 'monthly'
          }));
      } catch (e) {
        console.warn(`日記の年ディレクトリを読めませんでした (${dir.path}):`, e);
      }
    }

    // 月次まとめ（YYYY-MM）は同月の日別より古い扱いになるよう、キーを揃えて比較する
    return entries
      .sort((a, b) => (b.key.length === 7 ? `${b.key}-00` : b.key).localeCompare(a.key.length === 7 ? `${a.key}-00` : a.key))
      .slice(0, limit);
  }
};
