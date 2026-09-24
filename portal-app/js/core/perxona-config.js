// =====================
// Perxona Connect Kit の設定
// =====================
// Publishable Key / Avatar / Scene / Voice を localStorage に保持する。
// Key は既存の gh_pat / gemini_api_key と同じくブラウザの localStorage のみに置く（サーバーなし）。
//
// Region: Console（Key / Avatar / Scene / Voice の発行元）と SDK の CDN・API を一致させる必要がある。
//   無印の cdn.perxona.ai/prod/latest は eu の API に固定されているため、asia の Key では 401 になる。

const PERXONA_KEYS = {
  KEY:     'perxona_publishable_key',
  AVATAR:  'perxona_avatar_id',
  SCENE:   'perxona_scene_id',
  VOICE:   'perxona_voice_id',
  ENABLED: 'perxona_3d_enabled'
};

// ID のコピペで混入しがちな前後の空白・引用符・スラッシュを除く
function normalizePerxonaId(v) {
  return (v || '').trim().replace(/^["'\/]+|["'\/]+$/g, '').trim();
}

const PerxonaConfig = {
  REGION: 'asia',

  // 既定の組み合わせ（アバター一覧ページ avatars.html / 設定画面から変更できる）
  DEFAULTS: {
    avatarId: '01KD2C2QKHN8XZA7Y9S8J2ZNHJ',   // cc050_female_tsubasa
    sceneId:  '01M1JHG7TXY8E6AHH12VQYDQB8',   // sova_default_transparent（背景は舞台側の scene.json が担う）
    voiceId:  '01KXFXE2QJYNH7895KYT1QTAP6'    // Female - cute and kind（google）
  },

  get apiBase()  { return `https://console.perxona.ai/${this.REGION}/api/v1/connect`; },
  get sdkUrl()   { return `https://cdn.perxona.ai/${this.REGION}/prod/latest/widget/entry/presenter.js`; },

  getKey()      { return localStorage.getItem(PERXONA_KEYS.KEY) || ''; },
  setKey(v)     { localStorage.setItem(PERXONA_KEYS.KEY, (v || '').trim()); },

  getAvatarId() {
    // 旧バージョンが保存した「エージェントプロファイルの ID」等の誤値は、未設定の既定へ落とす
    return normalizePerxonaId(localStorage.getItem(PERXONA_KEYS.AVATAR)) || this.DEFAULTS.avatarId;
  },
  setAvatarId(v) { localStorage.setItem(PERXONA_KEYS.AVATAR, normalizePerxonaId(v)); },

  getSceneId() {
    // 旧バージョンが保存していた 'default' は実在しない ID
    const id = normalizePerxonaId(localStorage.getItem(PERXONA_KEYS.SCENE));
    return (id && id !== 'default') ? id : this.DEFAULTS.sceneId;
  },
  setSceneId(v) { localStorage.setItem(PERXONA_KEYS.SCENE, normalizePerxonaId(v)); },

  // 保存済みの空文字（＝「なし」を明示）と未保存（＝既定）を区別する
  getVoiceId() {
    const raw = localStorage.getItem(PERXONA_KEYS.VOICE);
    return raw === null ? this.DEFAULTS.voiceId : normalizePerxonaId(raw);
  },
  setVoiceId(v) { localStorage.setItem(PERXONA_KEYS.VOICE, normalizePerxonaId(v)); },

  // Key があれば既定で 3D。設定画面のスイッチで 2D 立ち絵へ戻せる
  isEnabled() {
    if (window.DEMO_MODE) return false;                       // デモは 2D 固定（導入計画 §5）
    if (!this.getKey()) return false;
    return localStorage.getItem(PERXONA_KEYS.ENABLED) !== '0';
  },
  setEnabled(on) { localStorage.setItem(PERXONA_KEYS.ENABLED, on ? '1' : '0'); },

  /** Connect API を Publishable Key で叩く（Allowed Domains 登録済みの origin から呼ぶこと） */
  async fetchJson(path) {
    const res = await fetch(`${this.apiBase}${path}`, { headers: { 'X-Connect-Key': this.getKey() } });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).details || ''; } catch (e) { /* 本文なし */ }
      throw new Error(`HTTP ${res.status} ${detail}`.trim());
    }
    return res.json();
  },

  /** ページ送りのある一覧を全件取得する */
  async fetchAll(path) {
    const items = [];
    let page = 1, pages = 1;
    do {
      const sep = path.includes('?') ? '&' : '?';
      const json = await this.fetchJson(`${path}${sep}page=${page}&size=100`);
      pages = json.pages || 1;
      items.push(...json.items);
      page++;
    } while (page <= pages);
    return items;
  }
};

window.PerxonaConfig = PerxonaConfig;
