/**
 * ReplyFeedback — 返信候補ボタンの押され方をフィードバックとして蓄積し、応答スタイルへ還流させる
 *
 * 「明示的な評価UI（★や👍）を足さず、既にある返信候補ボタンの選択そのものを評価とみなす」
 * という方針（ADR 038）。ユーザーの操作は次の3種類に分類する。
 *
 *   close  … 会話を閉じる系の候補を押した（例「ありがとう」）→ 満足か、話が長くて切り上げた
 *   more   … 掘り下げ系の候補を押した（例「もう少し詳しく」）→ 説明が足りなかった
 *   free   … 候補を使わず自分で書いた                        → 候補が的外れだった
 *
 * 還流は「次の対話リクエストのシステムプロンプトに数行足す」形で行うので追加リクエストは発生しない。
 *
 * ---
 * 永続先は vault の会話ログ1本（ADR 044 / 045）
 *
 * 評価種別は ADR 041 決定6 で会話ログに併記済み（`**[14:01] ユーザー（close）:**`）。
 * 起動時にそれを読んで集計の土台にする。**評価専用のファイルも localStorage も使わない**。
 *
 *   - 端末をまたいで同じ傾向が使われる
 *   - 「なぜ口調が変わったか」を後から人（や別の AI）が検証できる
 *   - 保存先が1つなので、どちらが正か迷う場面が生まれない
 *
 * このモジュールが持つのはセッション中の揮発分（`_sessionEvents` / `_violations`）だけ。
 * 会話ログは1往復ごとに flush されるので、次に開いたときには vault 側に入っている。
 *
 * **Gemini へ送る量は増えない**。読むのは GitHub Contents API であって Gemini ではなく、
 * プロンプトに載るのは promptGuide() が組み立てる数行（実測 176 文字・全体の 5%）だけ。
 * 遡る日数を 3→30 に増やしても promptGuide の長さは変わらない（実測で確認 / ADR 045）。
 *
 * 禁止語（ADR 044 / 045）
 *
 * card.json の `avoidWords` に「この人格が使ってはいけない語」を宣言する。
 * 平時は語を並べた1行、破ったら名指しで強く止める、の2段構え。
 * 本文に「使わない」と書くだけでは守られなかった（実例: 人格が京都弁「どす」を使った）。
 */

/** 集計に使う直近イベント数。増やすと傾向が鈍く、減らすと1回の操作で振れる。 */
const FEEDBACK_WINDOW = 20;
/** この件数に達するまでは傾向とみなさない（初回から偏った指示を出さないため） */
const FEEDBACK_MIN = 5;

/** 会話を閉じる意図の候補を判定する語 */
const CLOSE_WORDS = ['ありがとう', 'あんがと', 'おつかれ', 'また', 'わかった', '了解', 'なるほど', 'うん'];
/** 掘り下げを求める候補を判定する語 */
const MORE_WORDS  = ['詳しく', 'もっと', 'くわしく', 'どうして', 'なんで', '理由', '具体的'];

/** 会話ログから拾った履歴（起動時に vault から読む / ADR 044） */
const VAULT_LOG_DAYS = 3;          // 遡る日数。ファイルは並列に読む
const VIOLATION_KEEP = 5;          // 直近いくつの違反を覚えておくか

window.ReplyFeedback = {
  /** 会話ログ由来のイベント（新しいものが末尾）。未ロードなら null */
  _vaultEvents: null,
  _loadingVault: null,
  /** このセッションで発生した分（vault へ flush 済みでも重複は時刻で除く） */
  _sessionEvents: [],
  /** このセッションで検出した禁止語違反 */
  _violations: [],

  /**
   * 集計の土台になるイベント（ADR 045 で localStorage をやめた）。
   * 永続先は vault の会話ログ1本。ここに持つのはセッション中の揮発分だけ。
   */
  _read() {
    return { events: this._sessionEvents };
  },

  _write(data) {
    this._sessionEvents = data.events.slice(-FEEDBACK_WINDOW * 3);
  },

  /** 候補ラベルから種別を判定する */
  classify(label) {
    const s = String(label || '');
    if (MORE_WORDS.some(w => s.includes(w)))  return 'more';
    if (CLOSE_WORDS.some(w => s.includes(w))) return 'close';
    return 'other';   // AI が出した文脈依存の候補（狙いどおり使われた状態）
  },

  /**
   * 操作の種別だけを求める（記録はしない）。
   * 会話ログ側にも同じ判定を載せたいが、二重に record すると集計が倍になるため分けてある。
   * @param {'chip'|'free'} source chip:候補をタップ / free:自分で入力
   * @param {string} label 送信された文言
   * @returns {'close'|'more'|'free'|'other'}
   */
  kindOf(source, label) {
    return source === 'free' ? 'free' : this.classify(label);
  },

  /**
   * 操作を1件記録する。
   * @param {'chip'|'free'} source chip:候補をタップ / free:自分で入力
   * @param {string} label 送信された文言
   * @returns {'close'|'more'|'free'|'other'} 判定した種別（会話ログにも残すため返す）
   */
  record(source, label) {
    const kind = this.kindOf(source, label);
    const data = this._read();
    data.events.push({
      kind,
      label: String(label || '').slice(0, 40),
      at: new Date().toISOString()
    });
    this._write(data);
    return kind;
  },

  // ---------- 端末をまたいだ履歴（vault の会話ログから復元 / ADR 044） ----------

  /**
   * 直近 VAULT_LOG_DAYS 日分の会話ログを読み、評価種別つきのユーザー発話を拾う。
   * 失敗しても例外は投げない（PAT 未設定・オフラインでも対話は続けられるべきなので）。
   */
  loadFromVault(days = VAULT_LOG_DAYS) {
    // ADR 045 より前のバージョンが localStorage に残した集計を掃除する。
    // もう読まないので、置いたままだと「消したのに残っている」ように見えるだけ。
    try {
      localStorage.removeItem('reply_feedback_v1');
      localStorage.removeItem('persona_violations_v1');
    } catch (e) { /* 掃除できなくても動作に影響しない */ }

    if (this._loadingVault) return this._loadingVault;
    this._loadingVault = this._loadFromVault(days).catch(e => {
      console.warn('会話ログからの評価履歴の読み込みに失敗しました:', e);
      this._vaultEvents = [];
      return [];
    });
    return this._loadingVault;
  },

  async _loadFromVault(days) {
    if (typeof getToken !== 'function' || !getToken() || !getRepo()) { this._vaultEvents = []; return []; }
    if (typeof ConversationLog === 'undefined') { this._vaultEvents = []; return []; }

    const today = getJstTodayISO();
    const dates = [];
    for (let i = days - 1; i >= 0; i--) dates.push(shiftIsoDate(today, -i));

    // 並列に読む。直列だと日数に比例して起動が遅くなる（実測 30日で11秒 / ADR 045）。
    // 読み取りは GitHub API であって Gemini ではないので、トークンは1文字も増えない。
    const files = await Promise.all(
      dates.map(d => GitHubStorage.getFile(ConversationLog.path(d)).catch(() => null))
    );

    const events = [];
    files.forEach((res, i) => {
      if (res) events.push(...this.parseLog(res.content, dates[i]));
    });
    this._vaultEvents = events;
    return events;
  },

  /**
   * 会話ログ本文から評価種別つきの発話を抜き出す。
   *   **[14:01] ユーザー（close）:**
   * @returns {Array<{kind: string, at: string, source: 'vault'}>}
   */
  parseLog(markdown, date) {
    const out = [];
    const re = /^\*\*\[(\d{2}:\d{2})\]\s*[^（(]*[（(](close|more|free|other)[）)]\s*:\*\*/gm;
    let m;
    while ((m = re.exec(String(markdown || ''))) !== null) {
      out.push({ kind: m[2], at: `${date}T${m[1]}`, source: 'vault' });
    }
    return out;
  },

  /**
   * 集計に使うイベント列。vault 由来（他端末を含む履歴）＋ このセッション分。
   * 会話ログは1往復ごとに flush されるので、両方に載る分は時刻で重複を除く。
   */
  _mergedEvents() {
    const local = this._read().events.map(e => ({
      kind: e.kind,
      // セッション分は ISO 文字列（UTC）。JST の HH:MM に直して vault 側と突き合わせる
      at: this._toJstKey(e.at),
      source: 'local'
    }));
    if (!this._vaultEvents || this._vaultEvents.length === 0) return local;

    const seen = new Set(this._vaultEvents.map(e => `${e.at}|${e.kind}`));
    const localOnly = local.filter(e => !seen.has(`${e.at}|${e.kind}`));
    return [...this._vaultEvents, ...localOnly];
  },

  /** ISO(UTC) → 'YYYY-MM-DDTHH:MM'(JST)。会話ログの見出しと同じ粒度に揃える */
  _toJstKey(iso) {
    try {
      const d = new Date(iso);
      const jst = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
      const p = n => String(n).padStart(2, '0');
      return `${jst.getFullYear()}-${p(jst.getMonth() + 1)}-${p(jst.getDate())}T${p(jst.getHours())}:${p(jst.getMinutes())}`;
    } catch (e) {
      return String(iso || '');
    }
  },

  /** 直近 FEEDBACK_WINDOW 件の内訳 */
  tally() {
    const events = this._mergedEvents().slice(-FEEDBACK_WINDOW);
    const count = { close: 0, more: 0, free: 0, other: 0 };
    events.forEach(e => { if (count[e.kind] !== undefined) count[e.kind]++; });
    const fromVault = events.filter(e => e.source === 'vault').length;
    return { total: events.length, ...count, fromVault };
  },

  // ---------- 禁止語の検出（ADR 044） ----------

  /** card.json の `avoidWords` に宣言された語 */
  avoidWords() {
    return (window.AI_PERSONA && window.AI_PERSONA.avoidWords) || [];
  },

  /**
   * AI の返答に禁止語が混ざっていないか調べ、あれば記録する。
   * @param {string} reply 表示された本文（タグ除去後）
   * @returns {string[]} 見つかった語
   */
  checkViolation(reply) {
    const words = this.avoidWords();
    if (!words.length) return [];
    const text = String(reply || '');
    const hits = words.filter(w => w && text.includes(w));
    if (hits.length) this._violations = [...this._violations, ...hits].slice(-VIOLATION_KEEP);
    return hits;
  },

  /** 直近の違反で使われた語（重複を除く） */
  recentViolations() {
    return [...new Set(this._violations)];
  },

  clearViolations() {
    this._violations = [];
  },

  reset() {
    this._sessionEvents = [];
    this._violations = [];
    this._vaultEvents = null;
    this._loadingVault = null;
  },

  /**
   * 集計から導いた指示と、直近の返答の書き出しを返す。
   * 判定は JS 側で確定させ、AI には「どう振る舞うか」だけを渡す（解釈を委ねると効きが安定しない）。
   * @param {Array<{role: string, content: string}>} history chatHistory
   * @returns {string} システムプロンプトへ足すブロック（傾向が出ていなければ空文字）
   */
  promptGuide(history = [], opts = {}) {
    const lines = [];

    const t = this.tally();
    if (t.total >= FEEDBACK_MIN) {
      const ratio = k => t[k] / t.total;
      lines.push(`直近${t.total}回のユーザーの反応: 会話を閉じる返信 ${t.close} / 掘り下げる返信 ${t.more} / 候補を使わず自分で入力 ${t.free} / その他 ${t.other}`);

      // 相談モード中は「2文以内」への自動短縮を止める（深掘りが2往復で終わる原因になる）
      if (ratio('close') >= 0.5 && !opts.relaxLength) {
        lines.push('- 「ありがとう」で終わることが多い。返答は2文以内に収め、励ましは最後の1文だけにする。前置きと言い換えの繰り返しをやめる。');
      }
      if (ratio('more') >= 0.35) {
        lines.push('- 掘り下げを求められることが多い。最初から一歩踏み込んだ具体（数字・手順・例）を1つ入れる。');
      }
      if (ratio('free') >= 0.4) {
        lines.push('- 返信候補が使われていない。直前の話題に固有の名詞を含む、選びやすい候補を出す。');
      }
    }

    // 同じ入り方の反復（パターン化）を避けさせる
    const openings = history
      .filter(m => m.role === 'assistant' || m.role === 'model')
      .slice(-3)
      .map(m => String(m.content || '').replace(/\[[^\]]*\]/g, '').trim().slice(0, 8))
      .filter(Boolean);
    if (openings.length) {
      lines.push(`- 直近の返答の書き出し: ${openings.map(o => `「${o}」`).join(' ')}。同じ入り方・同じ定型句を続けて使わない。`);
    }

    // 同じ締めの反復（「ゆっくり休んでな」「いつでも話してな」等）も止める。
    // 2026-09 の会話ログで、書き出しは散らばっていても締めがほぼ固定だった（persona の禁止指示だけでは残った）。
    const closings = history
      .filter(m => m.role === 'assistant' || m.role === 'model')
      .slice(-3)
      .map(m => {
        const t = String(m.content || '').replace(/\[[^\]]*\]/g, '').trim();
        const sentences = t.split(/(?<=[。！？!?\n])/).map(s => s.trim()).filter(Boolean);
        return (sentences[sentences.length - 1] || '').slice(-14);
      })
      .filter(Boolean);
    if (closings.length) {
      lines.push(`- 直近の返答の締め: ${closings.map(o => `「…${o}」`).join(' ')}。似た言い回しで締めない。用件に触れた言葉で終えるか、締めの言葉なしで終える。`);
    }

    // 禁止語は2段構え（ADR 045）。
    //   平時 … 語を並べるだけの1行。人格定義の散文に埋もれないよう構造化した位置に出す
    //   違反時 … 名指しで強く止める
    // 平時の1行は数十文字しかない。埋もれて破られる（実例:「どす」）ほうが高くつく。
    const words = this.avoidWords();
    const violations = this.recentViolations();
    if (violations.length) {
      lines.push(`- **直近の返答で ${violations.map(w => `「${w}」`).join('・')} を使いました。`
        + 'これは使ってはいけない語です。二度と使わないでください。**');
    } else if (words.length) {
      lines.push(`- 次の語は使わない: ${words.map(w => `「${w}」`).join('・')}`);
    }

    if (!lines.length) return '';
    return `## ユーザーの反応から（この指示を最優先で守る）\n${lines.join('\n')}`;
  }
};
