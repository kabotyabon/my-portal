/**
 * Tool Dispatcher
 * AIからの関数呼び出しを具体的な処理に振り分けます。
 *
 * 書き込み系ツールは { ok, ... } の形で結果を返します。
 * 会話ログを見ると「保存しといたで」と報告したのに保存できていない往復が繰り返し起きており、
 * 原因の一つが「成功したかどうかを AI が判別できない戻り値」でした:
 *   - save_file は GitHub API の生レスポンス（成功の目印が無い巨大な JSON）
 *   - 失敗は「エラー: …」という散文の文字列（本文の一部と区別しにくい）
 * ok フラグを立てて、成功/失敗をひと目で分かる形にしています。
 */

/** 書き込み系ツールの失敗を表す共通の戻り値 */
function toolFailure(message) {
  return { ok: false, error: String(message || '不明なエラー') };
}

/**
 * AI がファイルへ書き込んだことを画面側へ知らせる。
 * 日記パネル（report.js）はこれを受けて、表示中の今日の日記を再読込する。
 * 「日記に書いて」と頼んでも開いている日記画面に反映されない問題への対処（2026-08-19）。
 */
function notifyVaultWrite(path) {
  try {
    window.dispatchEvent(new CustomEvent('vault-file-written', { detail: { path } }));
  } catch (e) { /* 通知できなくても書き込み自体は成功している */ }
}

/** 日記のパスから 'YYYY-MM-DD' を取り出す（見出しの自動生成用） */
function diaryDateOf(path) {
  const m = String(path || '').match(/vault\/diary\/(\d{4}-\d{2}-\d{2})\.md$/);
  return m ? m[1] : '';
}

window.ToolDispatcher = {
  /**
   * この往復で read_file したパス。
   * 「中身を知らないまま save_file で丸ごと置き換える」を止めるために使う。
   */
  _readPaths: new Set(),

  /** 1往復のはじめに呼ぶ。ai-chat.js のツールループから。 */
  beginTurn() {
    this._readPaths = new Set();
  },

  async dispatch(name, args) {
    console.log(`[AI Tool Call] ${name}`, args);

    try {
      switch (name) {
        case 'append_to_file': {
          // 追記は「読む→つなぐ→書く」をアプリ側でやる。
          // AI にこの3手を任せると read を飛ばして丸ごと上書きする事故が起きた（8/4・8/5 に実発生）。
          const text = String(args.text || '').trim();
          if (!text) return toolFailure('追記する文章が空です');

          const existing = await GitHubStorage.getFile(args.path).catch(() => null);
          let base = existing ? existing.content.replace(/\s*$/, '') : '';
          if (!base) {
            // 新規。日記なら日付見出しから始める
            const date = diaryDateOf(args.path);
            base = date ? `# ${date}\n` : '';
          }
          const merged = `${base}${base ? '\n' : ''}${text}\n`;

          const saved = await GitHubStorage.saveFile(
            args.path, merged, args.message || `📝 ${args.path} に追記`
          );
          if (!saved || !saved.commit) return toolFailure(`${args.path} への追記が確認できませんでした`);

          notifyVaultWrite(args.path);
          return {
            ok: true, path: args.path, appended: text.length,
            created: !existing,
            message: `${args.path} に追記しました（既存の内容は保持されています）`
          };
        }

        case 'save_file': {
          // 中身を知らないまま既存を消す書き込みを止める。
          // この往復で read_file していれば「分かったうえでの書き換え」なので通す。
          // 判定は長さではなく「既存の全文が新しい内容に残っているか」。
          // 8/5 の事故は追記文のほうが長く、長さで見ると素通りしていた。
          if (!this._readPaths.has(args.path)) {
            const before = await GitHubStorage.getFile(args.path).catch(() => null);
            const oldText = before ? before.content.trim() : '';
            const newText = String(args.content || '').trim();
            if (oldText && !newText.includes(oldText)) {
              return {
                ok: false,
                path: args.path,
                error: `${args.path} には既に ${oldText.length} 文字の内容があり、この書き込みはそれを消してしまいます。`
                     + '追記したいだけなら append_to_file を使ってください。'
                     + '本当に置き換えるなら、先に read_file で現在の中身を取得し、残したい部分を含めた全文を渡してください。'
              };
            }
          }

          const saved = await GitHubStorage.saveFile(args.path, args.content, args.message || 'Updated by AI Agent');
          if (!saved || !saved.commit) return toolFailure(`${args.path} への書き込みが確認できませんでした`);

          // commit が返っても中身が変わったとは限らない。
          // 同一内容を送ると GitHub は空コミットを作り、blob の SHA は据え置かれる。
          // 「追記したつもりが元のまま」を成功として報告しないよう、ここで区別する。
          const newSha = saved.content && saved.content.sha;
          const changed = !saved.previousSha || !newSha || newSha !== saved.previousSha;
          if (!changed) {
            return {
              ok: false,
              changed: false,
              path: args.path,
              error: `${args.path} の内容は書き込み前と同一でした。追記したい内容が content に入っていません。`
                   + 'まず read_file で現在の中身を取得し、そこへ追記した全文を content に渡してください。'
            };
          }
          notifyVaultWrite(args.path);
          return {
            ok: true, changed: true, path: args.path,
            bytes: (args.content || '').length,
            message: `${args.path} に保存しました`
          };
        }

        case 'read_file': {
          const res = await GitHubStorage.getFile(args.path);
          // 読んだ事実を覚えておく。save_file の上書きガードが参照する
          if (res) this._readPaths.add(args.path);
          return res ? res.content : toolFailure(`${args.path} が見つかりません`);
        }

        case 'list_files':
          const files = await GitHubStorage.listFiles(args.directory);
          return files.map(f => ({ name: f.name, path: f.path, type: f.type }));
        
        case 'get_today_reminders':
          return await TaskService.getTodayReminders();

        case 'get_tasks':
          return await TaskService.getActiveTasks();
        
        case 'add_task': {
          const task = await TaskRepository.addTask({
            title: args.title,
            priority: args.priority || 'P2',
            description: args.description || ''
          });
          if (!task) return toolFailure(`タスク「${args.title}」を登録できませんでした`);
          return { ok: true, task, message: `タスク「${args.title}」を登録しました` };
        }

        case 'update_task': {
          const { id, ...updates } = args;
          const task = await TaskRepository.updateTask(id, updates);
          if (!task) return toolFailure(`タスク ${id} が見つからないか、更新できませんでした`);
          return { ok: true, task, message: `タスク ${id} を更新しました` };
        }

        case 'remember_about_user':
          // profile.md（以降の対話に効く）と当日の日記（いつ・何を根拠にそうなったか）の両方に書く。
          // 片方だけだと、あとで振る舞いが変わった理由を追えない。
          return await PersonaState.remember(args.fact, args.section);

        case 'merge_journals':
          return await DiaryService.getMergedJournal(args.days || 7);

        case 'rollup_diary_month':
          return await DiaryService.rollupMonth(args.year_month, { deleteDaily: !!args.delete_daily });
        
        default:
          return toolFailure(`未知のツール「${name}」が呼び出されました`);
      }
    } catch (e) {
      console.error(`Tool Execution Error (${name}):`, e);
      return toolFailure(e.message);
    }
  }
};
