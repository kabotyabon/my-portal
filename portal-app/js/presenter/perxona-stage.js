/**
 * PerxonaStage — Perxona Connect Kit の <sv-presenter>（3D アバター＋音声＋リップシンク）
 *
 * 描画の 2D / 3D 切替は AvatarScene が担い、このクラスは 3D の初期化と発話だけを持つ。
 * 失敗したときは onFail を呼ぶだけで、2D へのフォールバックは呼び出し側（AvatarScene）が行う。
 *
 * 参照仕様: https://connect.perxona.ai/
 *   initializeWithConnectKey(publishableKey, { avatarId, sceneId, voiceId })
 *   present(text) / interruptPresentation() / resumeAudioPlayback()
 */
window.PerxonaStage = {
  presenterEl: null,
  isReady: false,
  _scriptPromise: null,

  /** SDK スクリプトを1回だけ読み込み、<sv-presenter> の登録完了まで待つ */
  loadSdk() {
    if (this._scriptPromise) return this._scriptPromise;
    const url = PerxonaConfig.sdkUrl;
    this._scriptPromise = new Promise((resolve, reject) => {
      const done = () => {
        // script の load 後もカスタム要素の登録は非同期のため、登録完了を待つ
        Promise.race([
          customElements.whenDefined('sv-presenter'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('sv-presenter の登録がタイムアウトしました')), 15000))
        ]).then(resolve, reject);
      };
      if (document.querySelector(`script[src="${url}"]`)) return done();
      const script = document.createElement('script');
      script.type = 'module';
      script.src = url;
      script.onload = done;
      script.onerror = () => reject(new Error('Perxona SDK の読み込みに失敗しました'));
      document.head.appendChild(script);
    }).catch(e => { this._scriptPromise = null; throw e; });
    return this._scriptPromise;
  },

  /**
   * 3D Presenter を container に差し込んで初期化する。
   * @param {HTMLElement} container 挿入先
   * @param {{onFail?: (reason: string) => void}} hooks
   * @returns {Promise<boolean>} 発話可能（Ready）になったら true
   */
  async init(container, hooks = {}) {
    const key = PerxonaConfig.getKey();
    if (!key) return false;

    try {
      await this.loadSdk();

      container.innerHTML = '';
      const presenter = document.createElement('sv-presenter');
      presenter.style.cssText = 'display:block;position:relative;width:100%;height:100%;isolation:isolate;';
      container.appendChild(presenter);
      this.presenterEl = presenter;
      this.isReady = false;

      const ready = new Promise((resolve, reject) => {
        presenter.addEventListener('PRESENTER_STATUS', (e) => {
          if (e.detail?.status === 'Ready') {
            this.isReady = true;
            document.dispatchEvent(new CustomEvent('perxona-ready'));
            resolve(true);
          }
        });
        presenter.addEventListener('PRESENTER_ERROR', (e) => {
          console.error('[PerxonaStage] Presenter error:', e.detail);
          reject(new Error('Presenter error'));
        });
        // 鍵が失効・ドメイン不許可・権限不足のとき（再試行しても同じ結果になる）
        presenter.addEventListener('CONNECT_KEY_REJECTED', () => {
          this.isReady = false;
          reject(new Error('Connect key rejected'));
        });
      });
      // 未処理の reject を出さない（初期化 await 側で拾う）
      ready.catch(() => {});

      const target = {
        avatarId: PerxonaConfig.getAvatarId(),
        sceneId:  PerxonaConfig.getSceneId()
      };
      // 音声エンジンが Perxona のときだけ声を付ける（Gemini TTS を選んでいれば 3D は無音で、声は GeminiTTS が出す）
      const usePerxonaVoice = typeof VoiceConfig === 'undefined' || VoiceConfig.getEngine() === 'perxona';
      const voiceId = usePerxonaVoice ? PerxonaConfig.getVoiceId() : '';
      if (voiceId) target.voiceId = voiceId;

      if (typeof presenter.initializeWithConnectKey !== 'function') {
        throw new Error('sv-presenter に initializeWithConnectKey がありません');
      }
      await presenter.initializeWithConnectKey(key, target);
      await ready;
      return true;
    } catch (e) {
      console.error('[PerxonaStage] Initialization failed:', e);
      this.isReady = false;
      if (hooks.onFail) hooks.onFail(e.message || String(e));
      return false;
    }
  },

  /** 音声再生のロック解除（ユーザー操作の中で呼ぶ必要がある） */
  unlockAudio() {
    if (this.presenterEl && typeof this.presenterEl.resumeAudioPlayback === 'function') {
      try {
        // Promise を返し、Presenter 未準備のときは reject される。待たずに握りつぶす（失敗は次の発話で分かる）
        Promise.resolve(this.presenterEl.resumeAudioPlayback())
          .catch(e => console.warn('[PerxonaStage] resumeAudioPlayback:', e.message || e));
      } catch (e) { console.warn('[PerxonaStage] resumeAudioPlayback error:', e); }
    }
  },

  /** 直近の present() の結果（{ success, code, message }）。音声が出ないときの診断用 */
  lastResult: null,

  /**
   * テキストを発話（TTS＋リップシンク＋モーション）させる。
   * present() は reject せず { success, code, message } を返す。
   */
  async present(text) {
    if (!this.presenterEl || !this.isReady || !text) return false;
    try {
      this.unlockAudio();
      const result = await this.presenterEl.present(text);
      this.lastResult = result || null;
      if (result && result.success === false) {
        console.warn('[PerxonaStage] present() failed:', result.code, result.message);
        return false;
      }
      return true;
    } catch (e) {
      console.error('[PerxonaStage] present() error:', e);
      return false;
    }
  },

  /** 現在の発話を中断 */
  interrupt() {
    if (this.presenterEl && typeof this.presenterEl.interruptPresentation === 'function') {
      try { this.presenterEl.interruptPresentation(); } catch (e) { console.warn('[PerxonaStage] interrupt error:', e); }
    }
  }
};
