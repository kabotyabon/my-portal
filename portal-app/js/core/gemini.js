/**
 * Gemini API 連携ユーティリティ
 * Tool Use (Function Calling) 対応版
 */

/**
 * 使用モデル。settings.js の接続テストもこれを参照する（2箇所で食い違わせない）。
 * 2026-08-18: gemini-2.5-flash → gemini-3.7-flash（最新 Flash）
 * 2026-08-19: → gemini-3.5-flash-lite。月額試算 約¥190 と最もコスパが良く、
 *             予算上限（月¥1,000）に対して十分な余裕があるため。
 */
const GEMINI_MODEL = 'gemini-3.5-flash-lite';

// 先頭が優先。混雑時のみ後ろへフォールバックする（thinkingLevel は 3 系の指定なので 3 系だけを並べる）
const GEMINI_MODELS = [GEMINI_MODEL, 'gemini-3.5-flash', 'gemini-3.7-flash'];
// モデルごとの1リクエストの上限（超えたら次のモデルへ）。3.5-flash-lite は通常 1〜2 秒、3.5-flash でも 15 秒前後
const GEMINI_TIMEOUTS_MS = [10000, 20000, 20000];

/**
 * Gemini API を呼び出す
 * @param {Array} contents - 会話履歴（Gemini 形式: [{role: 'user'|'model', parts: [{text: '...'}|{functionCall: '...'}]}]）
 * @param {string} systemInstruction - システム指示
 * @param {Array} tools - ツール定義（ToolDefinitions）
 * @returns {Promise<Object>} APIレスポンス全体
 */
async function callGeminiRaw(contents, systemInstruction = "", tools = null) {
  const key = getGeminiKey();
  if (!key) throw new Error('Gemini APIキーが設定されていません。');

  // APIキーは URL クエリではなくヘッダーで送る（ADR-033 決定事項7）。
  // クエリ文字列はリファラやログに残りやすいため。

  // 思考トークンも maxOutputTokens の枠を消費する。
  // 旧設定（2.5-flash・2048・思考無制限）ではツール判断を要する依頼（「日記に書いて」等）で
  // 思考だけが枠を使い切り、parts の無い応答（finishReason: MAX_TOKENS）が返っていた（2026-08-17/18 実発生）。
  // 出力枠を広げたうえで、思考は下限レベルに切って応答が必ず残るようにする。
  // thinkingLevel は Gemini 3 系の指定方法（2.5 系の thinkingBudget は廃止された数値指定）。
  const requestBody = {
    contents: contents,
    generationConfig: {
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingLevel: 'low' }
    }
  };

  if (systemInstruction) {
    requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  if (tools) {
    requestBody.tools = tools;
  }

  // 混雑(503)・レート制限(429)・一時的なサーバーエラー(500)、または無応答（タイムアウト）のときは、
  // 待たずに次のモデルへ切り替える（2026-09-21: 503「high demand」が実発生）。
  // 同じモデルへの再試行はしない: 混雑中は再試行しても同じ結果になりやすく、待ち時間だけが積み重なる。
  // それ以外のエラー（キー不正・入力不正など）は再試行しても直らないのですぐ投げる。
  let lastError;
  for (const [idx, model] of GEMINI_MODELS.entries()) {
    const timeoutMs = GEMINI_TIMEOUTS_MS[idx] || 20000;
    const started = performance.now();
    // 1リクエストごとに時間制限をかける。タイムアウトが無いと、混雑時に応答が返らないまま
    // 「考えています…」が1〜3分続く（2026-09-22 実発生）。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        }
      );
      const ms = Math.round(performance.now() - started);
      if (res.ok) {
        console.info(`[Gemini] ${model} OK ${ms}ms`);
        return await res.json();
      }

      const err = await res.json().catch(() => ({}));
      lastError = new Error(`Gemini API ${res.status}: ${err.error?.message || '不明なエラー'}`);
      if (![429, 500, 503].includes(res.status)) throw lastError;   // 再試行しても直らない
      console.warn(`[Gemini] ${model} ${res.status} ${ms}ms → 次のモデルへ`);
    } catch (e) {
      if (e.name === 'AbortError') {
        lastError = new Error(`Gemini API: ${model} が ${timeoutMs / 1000} 秒以内に応答しませんでした`);
        console.warn(`[Gemini] ${model} タイムアウト（${timeoutMs}ms）→ 次のモデルへ`);
      } else {
        throw e;   // 再試行しても直らないエラー、またはネットワーク断
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/**
 * 旧来の callGemini との互換性を維持しつつ、使いやすくラップしたもの
 */
async function callGemini(promptOrHistory, systemInstruction = "") {
  let contents = [];
  if (Array.isArray(promptOrHistory)) {
    contents = promptOrHistory.map(msg => ({
      role: msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));
  } else {
    contents = [{ role: 'user', parts: [{ text: promptOrHistory }] }];
  }

  const data = await callGeminiRaw(contents, systemInstruction);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

window.GEMINI_MODEL = GEMINI_MODEL;
window.callGeminiRaw = callGeminiRaw;
window.callGemini = callGemini;
