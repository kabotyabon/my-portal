/**
 * Diary Domain Service
 * 依存関係: js/storage/diary-repository.js, js/domains/task-service.js, js/domains/config-service.js
 */

window.DiaryService = {
  /**
   * 今日の日記データを取得または初期化する
   */
  async getTodayDiary() {
    const today = getJstTodayISO();
    let diary = await DiaryRepository.getDiary(today);
    
    if (!diary) {
      // 存在しない場合はテンプレートを生成
      const content = await this.generateTemplate(today);
      diary = {
        path: `vault/diary/${today}.md`,
        content: content,
        sha: ''
      };
    }
    return diary;
  },

  /**
   * 日記を保存する
   */
  async saveDiary(content, sha = '') {
    const today = getJstTodayISO();
    return await DiaryRepository.saveDiary(today, content, sha);
  },

  /**
   * AIによる振り返りを日記に追記する
   */
  async appendReflection(currentContent, aiComment) {
    const now = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    const reflectionBlock = `\n\n> [!NOTE] AI振り返り (${now})\n> ${aiComment.replace(/\n/g, '\n> ')}\n`;
    
    const newContent = currentContent.trimEnd() + reflectionBlock;
    // UI側の更新を待つためにここでは保存のみ行い、コンテンツを返す
    return newContent;
  },

  /**
   * 日記のテンプレートを生成する
   * （デイリーチェックリストのブロックは 2026-08-19 の機能削除に伴い廃止）
   */
  async generateTemplate(dateISO) {
    const memo = this.collectMemo(dateISO);
    const memoBlock = memo ? `## 📝 メモ\n${memo}\n\n` : '';
    return `# ${dateISO}\n\n${memoBlock}`;
  },

  /**
   * メモを収集する
   */
  collectMemo(dateISO) {
    return (localStorage.getItem(`daily-memo_${dateISO}`) || '').trim();
  },

  /**
   * 過去の日記を統合する（AI用）
   * 当月の日別ファイルと、年ディレクトリ内の月次まとめの両方を対象にする
   */
  async getMergedJournal(days = 7) {
    const targets = (await DiaryRepository.listEntries(days)).reverse();

    let merged = `# Journal Export (最新 ${days} 件)\n\n`;
    for (const file of targets) {
      const result = await GitHubStorage.getFile(file.path);
      if (result) {
        merged += `## ${file.key}${file.kind === 'monthly' ? '（月次まとめ）' : ''}\n\n${result.content}\n\n---\n\n`;
      }
    }
    return merged;
  },

  /**
   * 指定した月の日別ファイルを 1つの月次まとめへ統合する
   *
   *   vault/diary/2026-06-01.md, 2026-06-02.md, …
   *     → vault/diary/2026/2026-06.md（`# 2026年6月` + `## 2026年6月D日` + `---`）
   *
   * 当月は日別のまま運用するため、既定では当月を対象にできない。
   * deleteDaily: true を渡したときだけ、統合後に日別ファイルを削除する。
   *
   * @param {string} yearMonth 'YYYY-MM'
   * @param {{deleteDaily?: boolean, force?: boolean}} opts
   */
  async rollupMonth(yearMonth, opts = {}) {
    if (!/^\d{4}-\d{2}$/.test(yearMonth || '')) {
      return { ok: false, message: `月の指定が不正です: ${yearMonth}（YYYY-MM 形式で指定してください）` };
    }
    const currentMonth = getJstTodayISO().slice(0, 7);
    if (yearMonth === currentMonth && !opts.force) {
      return { ok: false, message: `${yearMonth} は当月です。当月は日別ファイルのまま運用します（force を指定すれば統合できます）。` };
    }

    const root = await GitHubStorage.listFiles('vault/diary');
    const dailies = root
      .filter(e => e.type === 'file' && e.name.startsWith(`${yearMonth}-`) && /^\d{4}-\d{2}-\d{2}\.md$/.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (dailies.length === 0) {
      return { ok: false, message: `${yearMonth} の日別ファイルは vault/diary 直下にありません（すでに統合済みの可能性があります）。` };
    }

    const [year, month] = yearMonth.split('-');
    const monthlyPath = DiaryRepository.monthlyPath(yearMonth);
    const existing = await GitHubStorage.getFile(monthlyPath).catch(() => null);

    // 既存の月次まとめがある場合は、月見出しを外した本文だけを前に残して追記する
    const header = `# ${Number(year)}年${Number(month)}月`;
    const prevBody = existing
      ? existing.content.replace(new RegExp(`^#\\s*${Number(year)}年${Number(month)}月\\s*\\n+`), '').trim()
      : '';

    // 同じ月を2回畳んでも重複しないよう、すでに見出しがある日は飛ばす（冪等性）
    const sections = [];
    const skipped = [];
    for (const file of dailies) {
      const day = parseInt(file.name.slice(8, 10), 10);
      const heading = `## ${Number(year)}年${Number(month)}月${day}日`;
      if (prevBody.includes(heading)) { skipped.push(file.name); continue; }

      const result = await GitHubStorage.getFile(file.path);
      if (!result) continue;
      // 日別ファイル先頭の `# YYYY-MM-DD` 見出しは月次側の `##` 見出しに置き換える
      const body = result.content.replace(/^#\s*\d{4}-\d{2}-\d{2}\s*\n+/, '').trim();
      sections.push(`${heading}\n\n${body}`);
    }

    if (sections.length === 0 && skipped.length === 0) {
      return { ok: false, message: `${yearMonth} の日別ファイルを読み込めませんでした。` };
    }

    // 本文は「既存本文」と「今回の追加分」を --- でつなぐ。月見出しの直後には --- を入れない。
    const bodyParts = [];
    if (prevBody) bodyParts.push(prevBody);
    if (sections.length > 0) bodyParts.push(sections.join('\n\n---\n\n'));
    const merged = `${header}\n\n${bodyParts.join('\n\n---\n\n')}`.trimEnd() + '\n';

    // 全日がすでに統合済みなら書き込まない（無意味なコミットを作らない）
    if (sections.length > 0) {
      await GitHubStorage.saveFile(monthlyPath, merged, `🗂 日記を月次まとめへ統合: ${yearMonth}`);
    }

    const deleted = [];
    if (opts.deleteDaily) {
      // 統合後の内容に各日の見出しが含まれていることを確認してから削除する
      for (const file of dailies) {
        const day = parseInt(file.name.slice(8, 10), 10);
        if (!merged.includes(`## ${Number(year)}年${Number(month)}月${day}日`)) continue;
        const ok = await GitHubStorage.deleteFile(file.path, `🗂 月次まとめへ統合済み: ${file.name}`);
        if (ok) deleted.push(file.name);
      }
    }

    const addedMsg = sections.length > 0
      ? `${yearMonth} の日別 ${sections.length} 件を ${monthlyPath} へ統合しました。`
      : `${yearMonth} はすべて ${monthlyPath} に統合済みでした。`;
    const skippedMsg = skipped.length > 0 ? `（統合済みのため ${skipped.length} 件はスキップ）` : '';

    return {
      ok: true,
      monthlyPath,
      mergedDays: sections.length,
      skipped,
      deleted,
      message: addedMsg + skippedMsg
        + (opts.deleteDaily
            ? `日別ファイル ${deleted.length} 件を削除しました。`
            : '日別ファイルは残しています（内容を確認したうえで delete_daily を指定して削除してください）。')
    };
  }
};
