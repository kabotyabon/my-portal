/**
 * PersonaState — ユーザー像と関係の記憶を持つ層
 *
 * card.json（人格の定義）と分けてある。分ける理由:
 *   - card.json は**人間が書くもの**で、対話では変化しない
 *   - profile.md は**AI が書き換えるもの**で、使うほど変わる
 *   - 人格を差し替えても profile.md は残る（記憶はキャラではなくユーザーに紐づく）
 *
 * profile.md は毎回のプロンプトに丸ごと載る。だから上限を持つ。
 * 上限が無いと (a) トークンが線形に増え、(b) 情報が薄まって効かなくなる。
 * 上限の判定はアプリ側で機械的にやる（AI に任せると守られない、と実測済み）。
 *
 * 書き込みは「覚えといて」と明示的に頼まれたときだけ。自動更新にしない理由は、
 * 何が書かれるかを人が見ないまま人格が変質するのを避けるため。
 *
 * 依存: js/storage/github-storage.js, js/core/config.js (getJstTodayISO)
 */

const PERSONA_STATE_DIR = 'vault/persona-state';

window.PersonaState = {
  PROFILE_PATH: `${PERSONA_STATE_DIR}/profile.md`,
  LEARNED_PATH: `${PERSONA_STATE_DIR}/learned.md`,

  /** profile.md の見出しと上限。AI にはこの名前しか渡さない（自由記述だと見出しが増殖する） */
  SECTIONS: [
    { name: '呼び方と距離感',       max: 3 },
    { name: 'いま気にかけていること', max: 3 },
    { name: '触れてほしくないこと',   max: 5 },
    { name: '応答の好み',           max: 5 }
  ],

  /** 日記側の受け皿。上限なし（その日の記録なので落とさない） */
  DIARY_HEADING: '🧠 覚えたこと',

  _profile: null,     // 本文（未ロードなら null）
  _loading: null,

  sectionNames() { return this.SECTIONS.map(s => s.name); },
  _sectionDef(name) { return this.SECTIONS.find(s => s.name === name) || null; },

  // ---------- 読み込み ----------

  /**
   * profile.md を読む。失敗しても例外は投げない
   * （PAT 未設定・オフラインでも対話は続けられるべきなので）。
   */
  load() {
    if (this._loading) return this._loading;
    this._loading = this._load().catch(e => {
      console.warn('profile.md の読み込みに失敗しました:', e);
      this._profile = '';
      return '';
    });
    return this._loading;
  },

  async _load() {
    if (typeof getToken !== 'function' || !getToken() || !getRepo()) { this._profile = ''; return ''; }
    const res = await GitHubStorage.getFile(this.PROFILE_PATH).catch(() => null);
    this._profile = res ? res.content : '';
    return this._profile;
  },

  // ---------- プロンプトへの注入 ----------

  /**
   * システムプロンプトへ載せる断片。中身が無ければ何も載せない。
   * reply-feedback.js の promptGuide() と同じ位置づけ（数行だけ足す）。
   */
  promptGuide() {
    const filled = this.filledSections(this._profile || '');
    if (filled.length === 0) return '';

    const body = filled
      .map(s => `### ${s.name}\n${s.lines.map(l => `- ${l}`).join('\n')}`)
      .join('\n');

    return `## ユーザーについて（これまでに覚えたこと）
${body}

- ここに書かれていることを前提にしてください。毎回確認し直さないこと。
- 書かれていないことを推測で補わないでください。`;
  },

  /** 本文のうち、行が1つ以上あるセクションだけ返す */
  filledSections(markdown) {
    const parsed = this.parseSections(markdown);
    return this.SECTIONS
      .map(s => ({ name: s.name, lines: parsed[s.name] || [] }))
      .filter(s => s.lines.length > 0);
  },

  // ---------- 純関数（DOM も通信も触らない。テスト対象） ----------

  /**
   * `## 見出し（最大N）` 配下の `- ` 行を集める。
   * @returns {Object<string, string[]>} 見出し名 → 行の配列（`- ` は外した本文）
   */
  parseSections(markdown) {
    const out = {};
    let current = null;
    String(markdown || '').split('\n').forEach(raw => {
      const line = raw.replace(/\r$/, '');
      const h = line.match(/^##\s+(.+?)(?:（最大\d+）)?\s*$/);
      if (h) { current = h[1].trim(); out[current] = out[current] || []; return; }
      if (!current) return;
      const item = line.match(/^-\s+(.*)$/);
      if (item && item[1].trim()) out[current].push(item[1].trim());
    });
    return out;
  },

  /**
   * 見出し配下へ1行追記する。見出しが無ければ末尾に作る。
   * 上限を超えたぶんは**古いほうから**落とす。
   *
   * @param {string} markdown 元の本文
   * @param {string} heading 見出し名（`（最大N）` は付けずに渡す）
   * @param {string} line 追記する1行（先頭の `- ` は付けない）
   * @param {number} max 0 なら上限なし
   * @returns {{content: string, dropped: string[]}}
   */
  appendToSection(markdown, heading, line, max = 0) {
    const text = String(markdown || '').replace(/\r\n/g, '\n');
    const item = String(line || '').trim();
    if (!item) return { content: text, dropped: [] };

    const lines = text.split('\n');
    const headRe = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(（最大\\d+）)?\\s*$`);

    let start = lines.findIndex(l => headRe.test(l.replace(/\r$/, '')));
    if (start === -1) {
      // 見出しが無い。末尾に作る
      const base = text.replace(/\s*$/, '');
      return { content: `${base}${base ? '\n\n' : ''}## ${heading}\n\n- ${item}\n`, dropped: [] };
    }

    // 次の `## ` までがこのセクション
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i].replace(/\r$/, ''))) { end = i; break; }
    }

    const body = lines.slice(start + 1, end);
    const items = body.filter(l => /^-\s+\S/.test(l.replace(/\r$/, '')));
    items.push(`- ${item}`);

    const dropped = [];
    while (max > 0 && items.length > max) dropped.push(items.shift().replace(/^-\s+/, ''));

    const rebuilt = [lines[start], '', ...items, ''];
    const next = [...lines.slice(0, start), ...rebuilt, ...lines.slice(end)];
    return { content: next.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '') + '\n', dropped };
  },

  // ---------- 書き込み ----------

  /**
   * ユーザーについて覚えたことを1件記録する。
   * profile.md（効かせる先）と当日の日記（根拠）の両方に書く。
   * 片方だけだと、あとで振る舞いが変わった理由を追えない。
   */
  async remember(fact, section) {
    const item = String(fact || '').trim();
    if (!item) return { ok: false, error: '覚える内容が空です' };

    const def = this._sectionDef(section);
    if (!def) {
      return {
        ok: false,
        error: `section は次のいずれかを指定してください: ${this.sectionNames().join(' / ')}`
      };
    }

    // --- 1. profile.md ---
    const existing = await GitHubStorage.getFile(this.PROFILE_PATH).catch(() => null);
    const base = existing ? existing.content : this.template();
    const { content, dropped } = this.appendToSection(base, def.name, item, def.max);

    const saved = await GitHubStorage.saveFile(
      this.PROFILE_PATH, content, `🧠 ユーザー像を更新: ${def.name}`
    );
    if (!saved || !saved.commit) return { ok: false, error: 'profile.md への書き込みが確認できませんでした' };
    this._profile = content;

    // --- 2. 当日の日記（根拠を残す。失敗しても 1 は成功として扱う） ---
    let diaryOk = false;
    try {
      const today = getJstTodayISO();
      const path = `vault/diary/${today}.md`;
      const now = new Date().toLocaleTimeString('ja-JP', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo'
      });
      const diary = await GitHubStorage.getFile(path).catch(() => null);
      const diaryBase = diary ? diary.content : `# ${today}\n`;
      const merged = this.appendToSection(diaryBase, this.DIARY_HEADING, `${now} ${item} → ${def.name}`, 0);
      const w = await GitHubStorage.saveFile(path, merged.content, `🧠 覚えたことを日記に記録: ${today}`);
      diaryOk = !!(w && w.commit);
    } catch (e) {
      console.warn('日記への反映に失敗しました:', e);
    }

    return {
      ok: true,
      section: def.name,
      dropped,
      diaryRecorded: diaryOk,
      message: `「${item}」を ${def.name} に覚えました`
        + (dropped.length ? `（上限 ${def.max} 件のため「${dropped.join('」「')}」を落としました）` : '')
        + (diaryOk ? '。今日の日記にも記録しました' : '。日記への記録は失敗しました')
    };
  },

  /** profile.md が無いときに作る雛形 */
  template() {
    const secs = this.SECTIONS.map(s => `## ${s.name}（最大${s.max}）\n`).join('\n');
    return `# ユーザー像

<!-- AI が remember_about_user ツールで書き換える。人が手で直してもよい。 -->
<!-- 上限を超えた分はアプリが古い行から落とす（AI の判断に任せない）。 -->
<!-- ここは「対話で変わるもの」だけ。人格の定義は assets/persona/card.json にある。 -->

${secs}`;
  }
};

// PAT が入ってから読む。app.js の初期化から呼ばれる。
window.addEventListener('portal-config-loaded', () => {
  window.PersonaState.load().catch(e => console.warn('PersonaState の読み込みに失敗:', e));
});
