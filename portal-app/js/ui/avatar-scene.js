/**
 * AvatarScene — アバターの表情差分と背景を管理する
 *
 * 責務:
 *   1. 使用中ペルソナの scene.json（マニフェスト）の読み込みと既定値の解決
 *   2. 舞台（背景・グロー・立ち絵フィルタ・呼吸の秒数）を表情に連動させる
 *   3. AI 応答に含まれる [表情:happy] / [背景:night] タグの抽出
 *   4. 表情画像が未配置でも壊れないフォールバック
 *        表情ファイル → fallbackFile（avatar.png）＋ CSS 疑似表情
 *
 * DOM 構造（partials/panel-ai.html）:
 *   .vn-stage
 *     ├─ .vn-bg-layer        背景（gradient / 画像）        z0
 *     ├─ .vn-glow-layer      グロー（表情に連動）            z1
 *     ├─ .vn-portrait-layer  立ち絵（img を2枚重ねてクロスフェード / breathe） z2
 *     ├─ .vn-scrim           下半分のスクリム                z3
 *     └─ 会話ログ・台詞・返信候補・入力バー                   z20〜z40
 *
 * 舞台の値は CSS カスタムプロパティとして .vn-stage に載せる:
 *   --stage-bg / --stage-glow / --portrait-filter / --breath-dur
 * 背景設定が mood のときは bg も表情に追従し、具体的な背景を選ぶとそちらが優先される。
 */

// 使用中のペルソナ一式の置き場。定義は js/core/config.js。
// このファイルが config.js より先に読まれる構成でも壊れないよう既定値を持たせる。
const PERSONA_BASE       = (typeof PERSONA_DIR !== 'undefined' ? PERSONA_DIR : 'assets/persona/');
const SCENE_MANIFEST_URL = `${PERSONA_BASE}scene.json`;
// 背景の永続化（BG_CONFIG_KEY / BG_LOCAL_KEY）は 2026-08-19 に設定UIと共に削除。
// 起動時はペルソナの defaultBackground から始まり、対話中の [背景:] タグでのみ変わる。

// 舞台の既定値（scene.json に bg / glow / filter / breath が無い表情のフォールバック）
const DEFAULT_SCENE = {
  bg: 'linear-gradient(180deg,#3A2A3C 0%,#241A2A 48%,#150E1A 100%)',
  glow: 'rgba(214,152,143,.32)',
  filter: 'none',
  breath: '6.5s'
};

// scene.json が読めない場合でも動くための最小マニフェスト
const FALLBACK_MANIFEST = {
  basePath: PERSONA_BASE,
  fallbackFile: 'avatar.png',
  defaultExpression: 'neutral',
  defaultBackground: 'mood',
  expressions: [{ id: 'neutral', label: '通常', file: 'avatar.png', aliases: [], ...DEFAULT_SCENE }],
  backgrounds: [
    { id: 'mood',  label: '表情に合わせる', mood: true },
    { id: 'night', label: '夜', gradient: 'linear-gradient(180deg,#2A1E38 0%,#1a0b2e 48%,#0a0612 100%)' }
  ],
  autoSchedule: [],
  inference: []   // タグ無し応答の表情推定語彙。人格の口調に依存するためパック側（scene.json）が持つ
};

window.AvatarScene = {
  manifest: null,
  currentExpression: null,
  currentBackground: null,

  _mounted: false,
  _activeLayer: 0,        // 0 / 1 の交互クロスフェード
  _resolved: new Map(),   // expressionId → { src, isFallback }
  _loaded: false,         // scene.json が確定したか（確定前は立ち絵を描かない）
  _loading: null,         // load() の多重呼び出し防止

  // ---------- マニフェスト ----------

  /** scene.json を読み込む。失敗しても例外は投げず最小マニフェストで動作する。 */
  load() {
    if (this._loading) return this._loading;
    this._loading = this._load();
    return this._loading;
  },

  async _load() {
    try {
      const res = await fetch(SCENE_MANIFEST_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      this.manifest = { ...FALLBACK_MANIFEST, ...json };
    } catch (e) {
      console.warn('scene.json の読み込みに失敗しました。既定のシーン設定で続行します:', e);
      this.manifest = { ...FALLBACK_MANIFEST };
    }

    // card.json の avatarUrl が指定されていればフォールバック画像として優先する
    const personaAvatar = window.AI_PERSONA && window.AI_PERSONA.avatarUrl;
    if (personaAvatar) this.manifest.personaAvatarUrl = personaAvatar;

    // 既定表情（またはこの時点で要求されている表情）だけ先に解決して描画する。
    // 全表情の先読みを待つと立ち絵が出るまで数百ms かかるため、残りは裏で読む。
    const firstId = (this.findExpression(this.currentExpression)
      || this.findExpression(this._m().defaultExpression)
      || this.expressions()[0] || {}).id;
    if (firstId) await this._preloadOne(firstId);

    this._loaded = true;
    // 初回だけはクロスフェードで出す（immediate だと立ち絵が唐突に現れる）
    this.apply({ fade: true });
    // マニフェスト確定後に 3D を起動する（mount() は確定前に return するため、ここでも呼ぶ）
    this.mountPerxona();

    this._preload();   // 残りの表情差分は待たずに先読みする
    return this.manifest;
  },

  _m() { return this.manifest || FALLBACK_MANIFEST; },

  expressions() { return this._m().expressions || []; },
  backgrounds() { return this._m().backgrounds || []; },

  /** 表情 id またはエイリアス・ラベルから定義を引く。見つからなければ null。 */
  findExpression(idOrAlias) {
    if (!idOrAlias) return null;
    const key = String(idOrAlias).trim().toLowerCase();
    return this.expressions().find(e =>
      e.id.toLowerCase() === key ||
      (e.label || '').toLowerCase() === key ||
      (e.aliases || []).some(a => String(a).toLowerCase() === key)
    ) || null;
  },

  findBackground(idOrLabel) {
    if (!idOrLabel) return null;
    const key = String(idOrLabel).trim().toLowerCase();
    return this.backgrounds().find(b =>
      b.id.toLowerCase() === key || (b.label || '').toLowerCase() === key
    ) || null;
  },

  /** フォールバック画像の URL（card.json の avatarUrl ＞ manifest.fallbackFile） */
  fallbackSrc() {
    const m = this._m();
    return m.personaAvatarUrl || `${m.basePath || ''}${m.fallbackFile || 'avatar.png'}`;
  },

  /**
   * 表情 id を実際の画像 URL に解決する。
   * 専用画像が存在しなければ isFallback: true を返し、CSS 疑似表情に切り替える。
   */
  resolve(expressionId) {
    const cached = this._resolved.get(expressionId);
    if (cached) return cached;
    const def = this.findExpression(expressionId);
    const src = def && def.file ? `${this._m().basePath || ''}${def.file}` : null;
    // 未検証の時点では「専用画像あり」と仮定し、読み込み失敗時に _preload / onerror が上書きする
    return { src: src || this.fallbackSrc(), isFallback: !src };
  },

  /** 表情画像を先読みし、存在しないものはフォールバック扱いに確定させる。 */
  async _preload() {
    await Promise.all(this.expressions().map(def => this._preloadOne(def.id)));
  },

  /** 表情1つ分だけ先読みする。解決済みなら何もしない。 */
  _preloadOne(expressionId) {
    if (this._resolved.has(expressionId)) return Promise.resolve();
    const def = this.findExpression(expressionId);
    if (!def) return Promise.resolve();

    const src = def.file ? `${this._m().basePath || ''}${def.file}` : null;
    if (!src) {
      this._resolved.set(def.id, { src: this.fallbackSrc(), isFallback: true });
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const img = new Image();
      img.onload  = () => { this._resolved.set(def.id, { src, isFallback: false }); resolve(); };
      img.onerror = () => { this._resolved.set(def.id, { src: this.fallbackSrc(), isFallback: true }); resolve(); };
      img.src = src;
    });
  },

  /** 専用画像が1枚も無い状態か（設定画面の案内表示用） */
  hasDedicatedImages() {
    return this.expressions().some(e => {
      const r = this._resolved.get(e.id);
      return r && !r.isFallback;
    });
  },

  // ---------- マウント・描画 ----------

  /** panel-ai.html 挿入後に呼ぶ。DOM 参照を取り直し、現在の表情・背景を描画する。 */
  mount() {
    const stage = document.querySelector('.vn-stage');
    if (!stage) return;
    this._mounted = true;
    // 3D が有効なら、準備が終わる（または失敗して 2D へ戻る）まで立ち絵を出さない。
    // 先に 2D を描くと、初回リロードで旧来の立ち絵が一瞬映ってから 3D に差し替わる。
    if (typeof PerxonaConfig !== 'undefined' && PerxonaConfig.isEnabled() && this._perxona !== 'failed') {
      stage.classList.add('is-3d-loading');
    }
    // scene.json 確定前は描かない。ここでフォールバック（丸アイコンの avatar.png）を
    // 出すと、直後に立ち絵へ差し替わって「別画像が一瞬映る」ちらつきになる。
    if (!this._loaded) { this.load(); return; }
    this.apply();
    this.mountPerxona();
  },

  // ---------- 3D（Perxona）----------
  // 描画の切替先。無効・失敗のときは従来の 2D 立ち絵のまま何も変わらない（フォールバック）。

  _perxona: 'idle',   // idle | loading | ready | failed

  /** 3D 層を初期化する。有効かつ Key があるときだけ動き、多重初期化はしない。 */
  mountPerxona() {
    const stage = document.querySelector('.vn-stage');
    const layer = document.getElementById('vn-3d-layer');
    if (!stage || !layer || typeof PerxonaConfig === 'undefined' || typeof PerxonaStage === 'undefined') return;

    if (!PerxonaConfig.isEnabled()) { this.unmountPerxona(); return; }
    // 同じ DOM に初期化済み／読み込み中なら何もしない
    if (this._perxona === 'loading') return;
    if (this._perxona === 'ready' && PerxonaStage.presenterEl && layer.contains(PerxonaStage.presenterEl)) {
      stage.classList.remove('is-3d-loading');
      stage.classList.add('is-3d');
      return;
    }

    this._perxona = 'loading';
    stage.classList.add('is-3d-loading');
    stage.classList.remove('is-3d');

    PerxonaStage.init(layer, {
      onFail: (reason) => this._perxonaFailed(reason)
    }).then((ok) => {
      stage.classList.remove('is-3d-loading');
      if (!ok) return;   // 失敗は onFail 側で処理済み
      this._perxona = 'ready';
      stage.classList.add('is-3d');
    });
  },

  /** 3D をやめて 2D へ戻す（設定でオフにしたとき） */
  unmountPerxona() {
    const stage = document.querySelector('.vn-stage');
    const layer = document.getElementById('vn-3d-layer');
    if (stage) stage.classList.remove('is-3d', 'is-3d-loading');
    if (layer) layer.innerHTML = '';
    if (typeof PerxonaStage !== 'undefined') { PerxonaStage.interrupt(); PerxonaStage.presenterEl = null; PerxonaStage.isReady = false; }
    this._perxona = 'idle';
  },

  /** 設定変更後に 3D を作り直す */
  remountPerxona() {
    this.unmountPerxona();
    this.mountPerxona();
  },

  _perxonaFailed(reason) {
    this._perxona = 'failed';
    const stage = document.querySelector('.vn-stage');
    if (stage) stage.classList.remove('is-3d', 'is-3d-loading');
    // 会話ログ（logChatFailure）は「返答を作れなかった」専用の書式のため使わない
    this._perxonaError = reason;
    console.warn('[AvatarScene] 3D の初期化に失敗したため 2D 表示に戻します:', reason);
    document.dispatchEvent(new CustomEvent('perxona-failed', { detail: { reason } }));
  },

  /** 3D が有効なとき、返答を音声つきで喋らせる（表情・候補タグ除去済みの本文を渡すこと） */
  speak(text) {
    if (this._perxona !== 'ready' || typeof PerxonaStage === 'undefined') return;
    const t = String(text || '').trim();
    if (!t) return;
    PerxonaStage.interrupt();
    PerxonaStage.present(t);
  },

  /** ユーザー操作の直後に呼ぶ。応答待ちの後では自動再生制限を解除できない。 */
  unlockAudio() {
    if (typeof PerxonaStage !== 'undefined') PerxonaStage.unlockAudio();
  },

  /**
   * 現在の状態を DOM に反映する（マニフェスト読み込み後・マウント後の両方から呼ばれる）
   * @param {{fade?: boolean}} opts fade:true でクロスフェードして出す（初回描画用）
   */
  apply(opts = {}) {
    if (!this._loaded) return;
    if (!document.querySelector('.vn-stage')) return;
    this.setBackground(this.currentBackground || this._m().defaultBackground);
    this.setExpression(this.currentExpression || this._m().defaultExpression, { immediate: !opts.fade });
  },

  /**
   * 表情を切り替える。
   * @param {string} expressionId
   * @param {{immediate?: boolean}} opts immediate:true でクロスフェードなし
   */
  setExpression(expressionId, opts = {}) {
    // scene.json 確定前は要求を覚えるだけにする。ここで描くと FALLBACK_MANIFEST 経由で
    // avatar.png（丸アイコン）が一瞬映り、直後に立ち絵へ差し替わってちらつく。
    if (!this._loaded) {
      if (expressionId) this.currentExpression = expressionId;
      return;
    }

    const def = this.findExpression(expressionId);
    const id  = def ? def.id : (this._m().defaultExpression || 'neutral');
    this.currentExpression = id;

    const layers = [
      document.getElementById('vn-portrait-a'),
      document.getElementById('vn-portrait-b')
    ];
    if (!layers[0] || !layers[1]) return;

    const { src, isFallback } = this._resolved.get(id) || this.resolve(id);
    const next = layers[this._activeLayer === 0 ? 1 : 0];
    const prev = layers[this._activeLayer];

    // 同じ画像なら差し替えず、疑似表情クラスだけ更新する（ちらつき防止）
    const sameSrc = prev.getAttribute('src') === src;
    const target  = sameSrc ? prev : next;

    if (!sameSrc) {
      target.onerror = () => {
        // 先読み後に消えた場合の保険
        if (target.getAttribute('src') !== this.fallbackSrc()) {
          this._resolved.set(id, { src: this.fallbackSrc(), isFallback: true });
          target.src = this.fallbackSrc();
          target.dataset.fallback = 'true';
        }
      };
      target.src = src;
    }

    target.dataset.expr     = id;
    target.dataset.fallback = isFallback ? 'true' : 'false';

    if (!sameSrc) {
      if (opts.immediate) {
        target.classList.add('no-transition');
        requestAnimationFrame(() => target.classList.remove('no-transition'));
      }
      target.classList.add('is-active');
      prev.classList.remove('is-active');
      this._activeLayer = this._activeLayer === 0 ? 1 : 0;
    } else {
      target.classList.add('is-active');
    }

    const stage = document.querySelector('.vn-stage');
    if (stage) stage.dataset.expr = id;

    this.applyScene(id);
  },

  // ---------- 舞台（背景 / グロー / フィルタ / 呼吸） ----------

  /** 表情 id に対応する舞台の値を返す（未定義のフィールドは既定値で埋める） */
  sceneFor(expressionId) {
    const def = this.findExpression(expressionId) || {};
    return {
      bg:     def.bg     || DEFAULT_SCENE.bg,
      glow:   def.glow   || DEFAULT_SCENE.glow,
      filter: def.filter || DEFAULT_SCENE.filter,
      breath: def.breath || DEFAULT_SCENE.breath
    };
  },

  /**
   * 表情に連動する舞台の値を CSS カスタムプロパティへ流す。
   * 立ち絵のオフセットは breathe が transform を占有するため、差は呼吸の秒数で表現する。
   */
  applyScene(expressionId) {
    const stage = document.querySelector('.vn-stage');
    if (!stage) return;

    const scene = this.sceneFor(expressionId);
    stage.style.setProperty('--stage-bg', scene.bg);
    stage.style.setProperty('--stage-glow', scene.glow);
    stage.style.setProperty('--portrait-filter', scene.filter);
    stage.style.setProperty('--breath-dur', scene.breath);

    // 表情ラベルはヘッダーの簡素化に伴い撤去（立ち絵そのものが表情を語る）
  },

  /** 背景設定が「表情に合わせる（mood）」かどうか */
  isMoodBackground() {
    const def = this.findBackground(this.currentBackground || this._m().defaultBackground);
    return !!(def && def.mood);
  },

  /**
   * 背景を切り替える。
   * @param {string} backgroundId  'mood' なら表情に追従、'auto' なら時刻から自動決定
   */
  setBackground(backgroundId) {
    // 表情と同じ理由でマニフェスト確定前は描かない（暫定マニフェストの背景が一瞬出る）
    if (!this._loaded) {
      if (backgroundId) this.currentBackground = backgroundId;
      return;
    }

    const requested = this.findBackground(backgroundId) ? backgroundId : (this._m().defaultBackground || 'mood');
    this.currentBackground = requested;

    const effective = this.resolveAutoBackground(requested);
    const def = this.findBackground(effective) || this.backgrounds()[0];
    const el  = document.getElementById('vn-bg-layer');

    if (el && def) {
      if (def.mood) {
        // 表情に追従させるため、インライン指定を外して CSS の var(--stage-bg) に任せる
        el.style.removeProperty('background-image');
        el.style.removeProperty('background-size');
        el.style.removeProperty('background-position');
      } else if (def.file) {
        el.style.backgroundImage = `url("${this._m().basePath || ''}${def.file}")`;
        el.style.backgroundSize  = 'cover';
        el.style.backgroundPosition = 'center';
      } else {
        el.style.backgroundImage = def.gradient || DEFAULT_SCENE.bg;
      }
      el.dataset.bg = def.id;
    }

    const stage = document.querySelector('.vn-stage');
    if (stage) stage.dataset.bg = def ? def.id : '';
  },

  /** 'auto' を JST の時刻から具体的な背景 id に解決する */
  resolveAutoBackground(backgroundId) {
    const def = this.findBackground(backgroundId);
    if (!def || !def.auto) return backgroundId;

    const hour = parseInt(new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false
    }), 10);
    const schedule = this._m().autoSchedule || [];
    for (const slot of schedule) {
      if (hour < slot.untilHour) return slot.background;
    }
    return 'night';
  },


  // ---------- AI 応答のタグ解析 ----------

  /**
   * 応答テキストから [表情:xxx] / [背景:xxx] タグを抽出し、
   * タグを取り除いた本文と、タグ位置で区切ったセグメントを返す。
   *
   * @returns {{ clean: string, segments: Array<{expression: string|null, background: string|null, text: string}> }}
   */
  parseCues(text) {
    const TAG = /\[\s*(表情|expr|emotion|背景|bg|background)\s*[:：]\s*([^\]]+?)\s*\]/gi;
    const segments = [];
    let clean = '';
    let cursor = 0;
    let expression = null;
    let background = null;
    let pendingExpr = null;
    let pendingBg   = null;
    let match;

    while ((match = TAG.exec(text)) !== null) {
      const chunk = text.slice(cursor, match.index);
      if (chunk) {
        segments.push({ expression, background, text: chunk });
        clean += chunk;
        expression = null;
        background = null;
      }
      const isBg = /^(背景|bg|background)$/i.test(match[1]);
      if (isBg) { background = match[2]; pendingBg = match[2]; }
      else      { expression = match[2]; pendingExpr = match[2]; }
      cursor = match.index + match[0].length;
    }

    const tail = text.slice(cursor);
    if (tail || segments.length === 0) {
      segments.push({ expression, background, text: tail });
      clean += tail;
    }

    return {
      clean: clean.replace(/[ \t]+\n/g, '\n').trim(),
      segments: segments.filter(s => s.text.trim() || s.expression || s.background),
      lastExpression: pendingExpr,
      lastBackground: pendingBg
    };
  },

  /**
   * タグが無い応答向けの簡易推定。文面の記号・語彙から表情を当てる。
   * 精度より「無表情のまま固まらないこと」を優先する。
   *
   * 語彙はコードに持たず scene.json の `inference` から読む。
   * 推定語彙は人格の口調に依存する（関西弁の「ええやん」等）ため、
   * パック側に置かないと別口調・別言語のペルソナが作れない。
   */
  inferExpression(text) {
    if (!text) return this._m().defaultExpression || 'neutral';
    const t = String(text);
    for (const rule of (this._m().inference || [])) {
      if (!rule || !rule.expression || !Array.isArray(rule.patterns) || !rule.patterns.length) continue;
      if (!this.findExpression(rule.expression)) continue;
      if (!rule._re) {
        try { rule._re = new RegExp(rule.patterns.join('|')); }
        catch (e) { rule._re = /$^/; console.warn(`inference の正規表現が不正です（${rule.expression}）:`, e); }
      }
      if (rule._re.test(t)) return rule.expression;
    }
    return this._m().defaultExpression || 'neutral';
  },

  /** システムプロンプトに載せる表情タグの使い方 */
  promptGuide() {
    const list = this.expressions()
      .map(e => `${e.id}（${e.label}）`)
      .join(' / ');
    return `## 表情タグ
返答の中に表情タグを入れると、あなたの立ち絵の表情が切り替わります。
- 書式: \`[表情:id]\` — そのタグ以降の文章を、その表情で話します。
- 使える id: ${list}
- 1つの返答に複数入れて、話の流れに合わせて表情を変えてもかまいません。
- 返答の冒頭には必ず1つ入れてください。タグ自体は画面に表示されません。
- 背景を変えたいときだけ \`[背景:id]\` を使えます（id: ${this.backgrounds().map(b => b.id).join(' / ')}）。既定の mood は表情に合わせて舞台が変わるので、場面転換したい時だけ指定してください。

## 返信候補タグ
返答の末尾に \`[候補:短い返事A|短い返事B]\` を置くと、ユーザーの手元に2つのボタンとして出ます。
- 12文字以内・2つまで。ユーザーが次に言いそうな短い返事を書いてください。
- 省略してもかまいません。タグ自体は画面に表示されません。`;
  }
};

// card.json が読めた後にフォールバック画像を確定させたいので、マニフェストは app.js から load() する。
// 背景の保存値の再適用（portal-config-loaded リスナー）は永続化の削除に伴い撤去した（2026-08-19）。
