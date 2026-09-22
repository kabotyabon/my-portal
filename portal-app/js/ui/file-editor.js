/**
 * File Editor（対象パス可変の汎用 Markdown ビューア／エディタ）
 *
 * report.js は「当日の日記」専用（reportContent / reportSha / DiaryService に密結合）だったため、
 * レンダリング・編集・保存のロジックだけを任意パスに対して使えるよう一般化したもの。
 * 依存関係: js/storage/github-storage.js, js/core/utils.js (renderMarkdown)
 */

window.createFileEditor = function createFileEditor(opts) {
  const $ = id => (id ? document.getElementById(id) : null);

  return {
    path: '',
    content: '',
    sha: '',
    tab: 'preview',
    dirty: false,

    _setStatus(msg, color) {
      const el = $(opts.statusId);
      if (!el) return;
      el.style.color = color || 'var(--text-sub)';
      el.textContent = msg;
    },

    /** 指定パスのファイルを読み込んで表示する */
    async open(path) {
      this._setStatus('読み込み中…');
      try {
        const res = await GitHubStorage.getFile(path);
        if (!res) {
          this._setStatus('ファイルが見つかりません', '#cf222e');
          return false;
        }
        this.path    = res.path || path;
        this.content = res.content;
        this.sha     = res.sha;
        this.dirty   = false;
        this.tab     = 'preview';

        const titleEl = $(opts.titleId);
        if (titleEl) titleEl.textContent = this.path;
        const wrapEl = $(opts.wrapId);
        if (wrapEl) wrapEl.classList.remove('is-hidden');

        this.render();
        this._setStatus('');
        return true;
      } catch (e) {
        console.error('FileEditor.open failed:', e);
        this._setStatus(`エラー: ${e.message}`, '#cf222e');
        return false;
      }
    },

    /**
     * すでに手元にある内容でエディタを開く。
     * 作成直後は GitHub Contents API の反映が遅れて getFile が 404 を返すことがあるため、
     * 書き込んだ内容をそのまま渡して開けるようにしている。
     */
    openWith(path, content, sha = '', tab = 'preview') {
      this.path    = path;
      this.content = content;
      this.sha     = sha;
      this.dirty   = false;
      this.tab     = tab;

      const titleEl = $(opts.titleId);
      if (titleEl) titleEl.textContent = this.path;
      const wrapEl = $(opts.wrapId);
      if (wrapEl) wrapEl.classList.remove('is-hidden');

      this.render();
      this._setStatus('');
      return true;
    },

    switchTab(tab) {
      // 編集中の内容を失わないよう、編集タブから離れる際に取り込む
      if (this.tab === 'edit') {
        const ta = $(opts.textareaId);
        if (ta) this.content = ta.value;
      }
      this.tab = tab;
      this.render();
    },

    render() {
      const preview = $(opts.previewId);
      const edit    = $(opts.editId);
      const tp      = $(opts.tabPreviewId);
      const te      = $(opts.tabEditId);

      if (tp) tp.classList.toggle('active', this.tab === 'preview');
      if (te) te.classList.toggle('active', this.tab === 'edit');

      if (this.tab === 'preview') {
        if (preview) {
          preview.classList.remove('is-hidden');
          preview.innerHTML = renderMarkdown(this.content || '（空のファイルです）');
        }
        if (edit) edit.classList.add('is-hidden');
      } else {
        if (preview) preview.classList.add('is-hidden');
        if (edit) edit.classList.remove('is-hidden');
        const ta = $(opts.textareaId);
        if (ta) ta.value = this.content;
      }
    },

    markDirty() {
      const ta = $(opts.textareaId);
      if (ta) this.content = ta.value;
      this.dirty = true;
      this._setStatus('未保存の変更があります');
    },

    /** 現在のパスへ保存する（sha は GitHubStorage.saveFile が都度取得するため渡さない） */
    async save() {
      if (!this.path) {
        this._setStatus('ファイルが選択されていません', '#cf222e');
        return false;
      }
      const ta = $(opts.textareaId);
      if (ta && this.tab === 'edit') this.content = ta.value;

      this._setStatus('保存中…');
      try {
        const message = typeof opts.saveMessage === 'function'
          ? opts.saveMessage(this.path)
          : (opts.saveMessage || `✏️ ${this.path} を編集`);
        const result = await GitHubStorage.saveFile(this.path, this.content, message);
        if (result && result.content && result.content.sha) this.sha = result.content.sha;
        this.dirty = false;
        this._setStatus('✅ 保存しました', '#1a7f37');
        return true;
      } catch (e) {
        console.error('FileEditor.save failed:', e);
        this._setStatus(`保存失敗: ${e.message}`, '#cf222e');
        return false;
      }
    },

    close() {
      this.path = ''; this.content = ''; this.sha = ''; this.dirty = false;
      const wrapEl = $(opts.wrapId);
      if (wrapEl) wrapEl.classList.add('is-hidden');
      this._setStatus('');
    }
  };
};
