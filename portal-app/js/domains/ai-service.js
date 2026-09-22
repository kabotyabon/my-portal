/**
 * AI Domain Service
 * 依存関係: js/storage/github-storage.js, js/domains/task-service.js
 */

window.AiService = {
  _knowledgeIndexCache: null,
  _archOverviewCache: null,

  /**
   * ナレッジ記事の索引（パス＋本文1行目）。ファイル名だけでは質問の言葉と一致しない限り
   * read_file される動機が生まれないため、要約行を添えて関連性を判断できるようにする。
   * 個人利用でファイル数・更新頻度が低いため、セッション中は1回だけ取得してキャッシュする。
   */
  async _getKnowledgeIndex() {
    if (this._knowledgeIndexCache !== null) return this._knowledgeIndexCache;
    try {
      const files = await GitHubStorage.listFiles('vault/knowledge');
      const mdFiles = files.filter(f => f.type === 'file' && f.name.endsWith('.md'));
      const entries = await Promise.all(mdFiles.map(async f => {
        try {
          const result = await GitHubStorage.getFile(f.path);
          const firstLine = (result?.content || '').split('\n').find(l => l.trim()) || '';
          return `- ${f.path}: ${firstLine.trim().slice(0, 80)}`;
        } catch (e) {
          return `- ${f.path}`;
        }
      }));
      this._knowledgeIndexCache = entries.join('\n');
    } catch (e) {
      console.warn('Knowledge index fetch error:', e);
      this._knowledgeIndexCache = '';
    }
    return this._knowledgeIndexCache;
  },

  /** アプリの全体像（README抜粋）。静的ファイルなのでセッション中1回だけ取得する */
  async _getArchOverview() {
    if (this._archOverviewCache !== null) return this._archOverviewCache;
    try {
      const res = await fetch('../docs/architecture/README.md');
      this._archOverviewCache = res.ok ? (await res.text()).slice(0, 1200) : '';
    } catch (e) {
      console.warn('Architecture context fetch error:', e);
      this._archOverviewCache = '';
    }
    return this._archOverviewCache;
  },

  /**
   * AIに渡す最新の文脈（日記・タスク・ナレッジ索引・アプリ概要）を収集して文字列にする。
   * すべて毎回送る（チェックボックスでの選択式はやめた。日記/タスク/概要は軽量で、
   * 送り忘れによる的外れな応答の方が実害が大きいと判断）。
   */
  async getLatestContext() {
    const contextParts = [];

    // 1. 直近の日記（当月の日別 + 年ディレクトリ内の月次まとめ。詳細は diary-tasks.md）
    try {
      const latestDiaries = await DiaryRepository.listEntries(3);

      for (const file of latestDiaries) {
        const result = await GitHubStorage.getFile(file.path);
        if (result) {
          contextParts.push(`### 日記: ${file.name}\n${result.content.slice(0, 500)}...`);
        }
      }
    } catch (e) { console.warn('Diary context fetch error:', e); }

    // 2. 現在のタスク
    try {
      const tasks = await TaskService.getActiveTasks();
      const taskStr = tasks.map(t => `- [ ] ${t.title} (${t.priority || 'P2'})`).join('\n');
      contextParts.push(`### アクティブなタスク:\n${taskStr || 'なし'}`);
    } catch (e) { console.warn('Task context fetch error:', e); }

    // 3. ナレッジ記事の索引（本文は全部載せるとトークンが嵩むため、
    //    パス＋1行目の要約だけ渡して必要な記事を read_file で読ませる）
    const knowledgeIndex = await this._getKnowledgeIndex();
    if (knowledgeIndex) {
      contextParts.push(`### ナレッジ記事の索引（詳細が必要なら read_file で読む）:\n${knowledgeIndex}`);
    }

    // 4. アプリの全体像（ハンドブックの overview）
    const overview = await this._getArchOverview();
    if (overview) {
      contextParts.push(`### アプリの全体像（設計ドキュメントの抜粋）:\n${overview}...`);
    }

    return contextParts.join('\n\n');
  }
};
