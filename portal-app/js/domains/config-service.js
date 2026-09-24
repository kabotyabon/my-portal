/**
 * Config Domain Service
 * 依存関係: js/storage/config-repository.js
 */

window.ConfigService = {
  data: {
    kintaiUrl: ''
  },

  /**
   * アプリ起動時の初期化
   */
  async init() {
    let config;
    try {
      config = await ConfigRepository.loadConfig();
    } catch (e) {
      if (e instanceof GitHubAuthError) {
        this._showAuthError();
        this.data = { ...this.data, ...this._getFromLocalStorage() };
        return;
      }
      throw e;
    }

    if (config) {
      // ロードしたデータで上書きしつつ、欠落しているフィールドは localStorage から補完（移行用）
      const merged = {
        ...this.data,
        ...this._getFromLocalStorage(), // 優先度低
        ...config                       // 優先度高
      };
      this.data = merged;

      // 実質差分がある場合のみ保存する
      // 無条件に保存すると毎回「⚙️ 設定同期と補完」コミットが発生してしまう
      if (this._stableStringify(merged) !== this._stableStringify(config)) {
        try {
          await this.updateConfig({}, '⚙️ 設定同期と補完');
        } catch (e) {
          if (e instanceof GitHubAuthError) this._showAuthError();
        }
      } else {
        // 保存はしないが、localStorage 同期と読み込み完了通知は従来どおり行う
        this._syncToLocalStorage();
        window.dispatchEvent(new Event('portal-config-loaded'));
      }
    } else {
      // 完全新規: localStorage から移行
      await this.migrateFromLocalStorage();
    }
  },

  /**
   * キー順に依存しない比較用の JSON 文字列を作る
   * （マージ後オブジェクトはキーの並びが元データと異なるため、素の JSON.stringify では比較できない）
   */
  _stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(v => this._stableStringify(v)).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort()
        .map(k => `${JSON.stringify(k)}:${this._stableStringify(value[k])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
  },

  /**
   * localStorage から現在の設定値を取得する（互換用）
   * 存在する値のみをオブジェクトにして返す
   */
  _getFromLocalStorage() {
    const map = {
      kintaiUrl: () => localStorage.getItem('kintai_sheet_url'),
    };

    const result = {};
    for (const [key, getter] of Object.entries(map)) {
      try {
        const val = getter();
        if (val !== null && val !== undefined) result[key] = val;
      } catch (e) {}
    }
    return result;
  },

  /**
   * 設定値を更新して保存する
   */
  async updateConfig(updates, message) {
    this.data = { ...this.data, ...updates };
    await ConfigRepository.saveConfig(this.data, message);
    this._syncToLocalStorage();
    window.dispatchEvent(new Event('portal-config-loaded'));
  },

  /**
   * localStorage 依存の既存機能との互換性維持
   */
  _syncToLocalStorage() {
    localStorage.setItem('kintai_sheet_url', this.data.kintaiUrl);
  },

  /**
   * GitHub PAT が無効な場合に画面へ通知する
   */
  _showAuthError() {
    const existing = document.getElementById('portal-auth-error-banner');
    if (existing) return;
    const banner = document.createElement('div');
    banner.id = 'portal-auth-error-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#c0392b;color:#fff;padding:10px 16px;font-size:0.85rem;display:flex;align-items:center;gap:12px;';
    banner.innerHTML = `
      <span style="flex:1;">⚠️ アクセスキーが無効です。設定画面で更新してください。</span>
      <button onclick="if(window.innerWidth<=MOBILE_BREAKPOINT)switchBottomNav('settings');else switchMainTab('settings');" style="background:#fff;color:#c0392b;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-weight:bold;">設定を開く</button>
      <button onclick="this.parentElement.remove();" style="background:transparent;color:#fff;border:none;cursor:pointer;font-size:1.1rem;">✕</button>
    `;
    document.body.prepend(banner);
  },

  /**
   * 初回起動時にlocalStorageから移行する
   */
  async migrateFromLocalStorage() {
    console.log('ConfigService: Migrating from localStorage...');
    this.data = {
      kintaiUrl: localStorage.getItem('kintai_sheet_url') || ''
    };
    try {
      await this.updateConfig({}, '🔧 初期設定作成（localStorage から移行）');
    } catch (e) {
      if (e instanceof GitHubAuthError) this._showAuthError();
      else console.error('設定の保存に失敗しました:', e);
    }
  }
};
