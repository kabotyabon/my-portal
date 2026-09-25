// =====================
// Gemini TTS（音声層・2026-09-25〜）
// =====================
// 返答を Gemini の音声合成で読み上げる。表示（2D / 3D）とは独立に選べる音声エンジン。
// キーは既存の Gemini API キー（localStorage・秘匿扱い）をそのまま使う。
//
// API: POST /v1beta/interactions（response_format: audio）。既定の返りは WAV（24kHz / mono / 16bit）。
// 料金は音声出力トークン課金（25 token/秒）。lite で 10 秒の返答が約 $0.0015。
// 2027-01-01 から単価が倍になる予定なので、既定は lite にしておく。

const GEMINI_TTS_MODEL = 'gemini-3.8-flash-lite-tts';

// 音声エンジンの選択。'' = なし / 'gemini' / 'perxona'
const VOICE_KEYS = {
  ENGINE: 'voice_engine',
  GEMINI_VOICE: 'gemini_tts_voice'
};

// Studio voices（名前は API の値そのまま。説明は公式の特徴語の意訳）
const GEMINI_TTS_VOICES = [
  ['Leda', '若々しい'], ['Aoede', '軽やか'], ['Kore', 'しっかり'], ['Zephyr', '明るい'],
  ['Puck', '元気'], ['Autonoe', '明るい'], ['Despina', 'なめらか'], ['Erinome', 'クリア'],
  ['Laomedeia', '快活'], ['Achernar', 'やわらか'], ['Vindemiatrix', 'おだやか'], ['Sulafat', 'あたたかい'],
  ['Callirrhoe', 'のんびり'], ['Umbriel', 'のんびり'], ['Achird', '親しげ'], ['Sadachbia', '生き生き'],
  ['Pulcherrima', 'まっすぐ'], ['Schedar', '落ち着き'], ['Gacrux', '大人びた'], ['Enceladus', '息まじり'],
  ['Charon', '知的'], ['Rasalgethi', '知的'], ['Sadaltager', '博識'], ['Iapetus', 'クリア'],
  ['Algieba', 'なめらか'], ['Orus', 'しっかり'], ['Alnilam', 'しっかり'], ['Fenrir', '興奮ぎみ'],
  ['Algenib', 'しゃがれ'], ['Zubenelgenubi', 'くだけた']
];
const GEMINI_TTS_DEFAULT_VOICE = 'Leda';

// 無音の極小 WAV。ユーザー操作の直後に1回鳴らして、同じ <audio> の自動再生制限を解除する
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQAAAAA=';

const VoiceConfig = {
  getEngine() {
    const v = localStorage.getItem(VOICE_KEYS.ENGINE);
    if (v !== null) return v;
    // 未設定（この機能より前からの利用者）: 3D で Perxona の声を使っていたならそれを引き継ぐ
    return (typeof PerxonaConfig !== 'undefined' && PerxonaConfig.isEnabled() && PerxonaConfig.getVoiceId()) ? 'perxona' : '';
  },
  setEngine(v) { localStorage.setItem(VOICE_KEYS.ENGINE, v || ''); },
  getGeminiVoice() { return localStorage.getItem(VOICE_KEYS.GEMINI_VOICE) || GEMINI_TTS_DEFAULT_VOICE; },
  setGeminiVoice(v) { localStorage.setItem(VOICE_KEYS.GEMINI_VOICE, v || GEMINI_TTS_DEFAULT_VOICE); }
};

/** 読み上げ用に本文を整える（Markdown 記号・URL・絵文字は声にすると邪魔） */
function _ttsCleanText(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>|~]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** レスポンスから音声（base64 と MIME）を探す。steps[].content[] の中にある */
function _findAudio(node) {
  if (!node || typeof node !== 'object') return null;
  const mime = node.mime_type || node.mimeType || '';
  if (typeof node.data === 'string' && (node.type === 'audio' || mime.startsWith('audio'))) {
    return { data: node.data, mime: mime || 'audio/wav' };
  }
  for (const v of Object.values(node)) {
    const found = _findAudio(v);
    if (found) return found;
  }
  return null;
}

/** ヘッダ無しの PCM（audio/l16 等）が返ったときに WAV へ包む */
function _pcmToWav(bytes, sampleRate = 24000) {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + bytes.length, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, bytes.length, true);
  return new Blob([header, bytes], { type: 'audio/wav' });
}

const GeminiTTS = {
  _audio: null,
  _url: null,
  _seq: 0,          // 古い合成結果が後から届いても鳴らさないための通し番号
  lastError: null,

  _el() {
    if (!this._audio) this._audio = new Audio();
    return this._audio;
  },

  /** ユーザー操作の直後に呼ぶ（応答待ちの後では自動再生制限を解除できない） */
  unlock() {
    const a = this._el();
    if (a.dataset.unlocked) return;
    a.src = SILENT_WAV;
    a.play().then(() => { a.dataset.unlocked = '1'; }).catch(() => {});
  },

  interrupt() {
    this._seq++;
    if (this._audio) this._audio.pause();
  },

  /**
   * 読み上げる。成功で true。
   * @param {string} text
   * @param {{voice?: string, style?: string}} [opts]
   */
  async speak(text, opts = {}) {
    const key = typeof getGeminiKey === 'function' ? getGeminiKey() : '';
    const t = _ttsCleanText(text);
    if (!key || !t) return false;
    this.interrupt();
    const seq = this._seq;

    const content = { type: 'text', text: t };
    const style = opts.style ?? (window.AI_PERSONA && window.AI_PERSONA.voiceStyle);
    if (style) content.annotations = [{ type: 'speech_metadata', style }];

    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          model: GEMINI_TTS_MODEL,
          input: [{ type: 'user_input', content: [content] }],
          response_format: { type: 'audio' },
          generation_config: { speech_config: [{ voice: opts.voice || VoiceConfig.getGeminiVoice() }] }
        })
      });
      if (!res.ok) {
        // エラー本文は配列で返ることがある（[{ error: {...} }]）
        const body = await res.json().catch(() => ({}));
        const err = Array.isArray(body) ? body[0] : body;
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }
      const audio = _findAudio(await res.json());
      if (!audio) throw new Error('応答に音声が含まれていません');
      if (seq !== this._seq) return false;   // 待っている間に次の発話・中断が来た

      const bin = Uint8Array.from(atob(audio.data), c => c.charCodeAt(0));
      const blob = /wav/.test(audio.mime) ? new Blob([bin], { type: 'audio/wav' })
        : /l16|pcm/.test(audio.mime) ? _pcmToWav(bin, Number((audio.mime.match(/rate=(\d+)/) || [])[1]) || 24000)
        : new Blob([bin], { type: audio.mime });
      if (this._url) URL.revokeObjectURL(this._url);
      this._url = URL.createObjectURL(blob);
      const a = this._el();
      a.src = this._url;
      await a.play();
      this.lastError = null;
      return true;
    } catch (e) {
      this.lastError = e.message;
      console.warn('[GeminiTTS] 読み上げに失敗しました:', e);
      return false;
    }
  }
};

window.GEMINI_TTS_VOICES = GEMINI_TTS_VOICES;
window.VoiceConfig = VoiceConfig;
window.GeminiTTS = GeminiTTS;
