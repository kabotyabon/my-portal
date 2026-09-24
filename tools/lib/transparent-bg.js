/**
 * 生成画像の「背景」を透過にする共通処理
 *
 * Nano Banana に透過を指示すると、実際には
 *   (a) 白ベタ
 *   (b) 透過を表す市松模様の描き込み（セル 30px / 45px）
 * のどちらかが返ってくる。どちらも無彩色なので、彩度で人物と切り分けられる。
 *
 * 手順
 *   1. 外周からフラッドフィルして「外側の背景」を抜く
 *   2. 髪の隙間など外周から到達できない閉領域は、市松の格子と一致するかで判定して抜く
 *      （歯・瞳のハイライトは無彩色で明るいが格子と一致しないため残る）
 *   3. 背景に隣接した無彩色の明部を段階的に透過してフチを抑える
 *
 * remove-generated-background.js（1枚＝1キャラ）と
 * split-expression-sheet.js（1枚に複数キャラ）の両方から使う。
 */

const BG_MIN     = 182;  // 背景とみなす min(r,g,b) の下限（外周から読み取れなかったときの既定）
const BG_CHROMA  = 14;   // 背景とみなす max-min の上限（無彩色判定）
const BG_TONE_TOL = 12;  // 外周から読み取ったトーンの許容幅（ビネットで少し振れる）
const EDGE_CHROMA = 22;
const POCKET_MIN_AREA  = 40;   // これ未満の閉領域は判定しない
// 閉領域が市松かどうかは「2トーンを両方含むか」で判定する。
// 市松のセル割りは生成物ゆえ不規則（44/45/46px）で格子の位相計算は当てにならないが、
// 色は暗部・明部の2値しかない。一方まぶた・白目・歯は中間調のグラデーションで、
// 実測では暗部トーン一致が 0〜4%・明部が 0〜2% に収まり、市松（19〜46%）と明確に分かれる。
const POCKET_TONE_TOL  = 5;    // 暗部トーンの許容幅
const POCKET_MIN_DARK  = 0.15; // 暗部トーンの占有率の下限
const POCKET_MIN_LIGHT = 0.15; // 明部（>=250）の占有率の下限

/**
 * 外周1px から背景のトーンを読み取る。
 *
 * 市松の色は生成のたびに違う（明部 255 のこともあれば 240、暗部は 152 のことも 230 のこともある）。
 * 固定のしきい値で「明るい無彩色＝背景」と決め打ちすると、暗めの市松を人物と誤認して
 * 全部つながった1つの塊になってしまう。外周はどの生成物でも必ず背景なので、そこから読む。
 *
 * @returns {{allowed: Uint8Array, mid: number, light: number, dark: number}}
 *   allowed[minCh] が 1 の値を背景トーンとみなす。mid は明暗を分ける中点。
 */
function readBackgroundTones(minCh, chroma, W, H) {
  const hist = new Array(256).fill(0);
  const sample = i => { if (chroma[i] <= BG_CHROMA) hist[minCh[i]]++; };
  for (let x = 0; x < W; x++) { sample(x); sample((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { sample(y * W); sample(y * W + W - 1); }

  const total = hist.reduce((a, b) => a + b, 0);
  if (total === 0) {
    const allowed = new Uint8Array(256);
    for (let v = BG_MIN; v < 256; v++) allowed[v] = 1;
    return { allowed, mid: 246, light: 255, dark: BG_MIN };
  }

  // 外周に出てくるトーンをそのまま採用する（±BG_TONE_TOL で広げる）
  const allowed = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    if (hist[v] * 400 < total) continue;   // 0.25% 未満は人物のはみ出しとみなして無視
    for (let d = -BG_TONE_TOL; d <= BG_TONE_TOL; d++) {
      const t = v + d;
      if (t >= 0 && t < 256) allowed[t] = 1;
    }
  }

  const used = [];
  for (let v = 0; v < 256; v++) if (hist[v] * 400 >= total) used.push(v);
  const light = used.length ? used[used.length - 1] : 255;
  const dark  = used.length ? used[0] : BG_MIN;
  return { allowed, mid: Math.round((light + dark) / 2), light, dark };
}

/**
 * 背景が市松模様かどうかを外周1pxの明暗の切り替わり回数で判定する。
 * 白ベタなら切り替わらない（= 閉領域を抜く処理そのものを行わない）。
 * 明暗の境目は外周から読み取った中点を使う（固定値だと暗い市松を取りこぼす）。
 */
function detectChecker(minCh, W, mid) {
  const tone = x => (minCh[2 * W + x] >= mid ? 1 : 0);
  let switches = 0;
  for (let x = 1; x < W; x++) if (tone(x) !== tone(x - 1)) switches++;
  return switches >= 4 ? { switches } : null;
}

/**
 * 背景マスクを求める。data は書き換えない。
 * @returns {{bg: Uint8Array, minCh: Uint8Array, chroma: Uint8Array, checker, stats}}
 */
function computeBackground(data, W, H, C) {
  const N = W * H;

  const minCh = new Uint8Array(N);
  const chroma = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const o = i * C, r = data[o], g = data[o + 1], b = data[o + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    minCh[i] = mn;
    chroma[i] = Math.min(255, mx - mn);
  }
  const tones = readBackgroundTones(minCh, chroma, W, H);
  const isBgColor = i => chroma[i] <= BG_CHROMA && tones.allowed[minCh[i]] === 1;
  // フチをぼかす対象は「背景の暗いほうのトーンより明るい無彩色」
  const edgeMin = Math.max(0, tones.dark - BG_TONE_TOL);

  // --- 1. 外周からのフラッドフィル ---
  const bg = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const push = i => { if (!bg[i] && isBgColor(i)) { bg[i] = 1; stack[sp++] = i; } };

  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % W, y = (i - x) / W;
    if (x > 0)     push(i - 1);
    if (x < W - 1) push(i + 1);
    if (y > 0)     push(i - W);
    if (y < H - 1) push(i + W);
  }
  let outerCleared = 0;
  for (let i = 0; i < N; i++) if (bg[i]) outerCleared++;

  // --- 2. 閉領域を格子との一致で判定 ---
  const checker = detectChecker(minCh, W, tones.mid);
  let pockets = 0, pocketPx = 0, kept = 0, keptPx = 0;

  if (checker) {
    // 外側背景の「暗いほうのトーン」の最頻値を求める（市松の暗部の色）
    const hist = new Array(256).fill(0);
    for (let i = 0; i < N; i++) if (bg[i] && minCh[i] < tones.mid) hist[minCh[i]]++;
    const darkTone = hist.indexOf(Math.max(...hist));

    const seen = new Uint8Array(N);
    const comp = new Int32Array(N);
    for (let s = 0; s < N; s++) {
      if (!isBgColor(s) || bg[s] || seen[s]) continue;
      let ci = 0;
      seen[s] = 1; comp[ci++] = s;
      for (let k = 0; k < ci; k++) {
        const i = comp[k];
        const x = i % W, y = (i - x) / W;
        const nb = [];
        if (x > 0)     nb.push(i - 1);
        if (x < W - 1) nb.push(i + 1);
        if (y > 0)     nb.push(i - W);
        if (y < H - 1) nb.push(i + W);
        for (const j of nb) if (isBgColor(j) && !bg[j] && !seen[j]) { seen[j] = 1; comp[ci++] = j; }
      }
      // 周囲がほぼ透過で囲まれた小片は、大きさに関係なく背景の取り残し
      let border = 0, borderBg = 0;
      for (let k = 0; k < ci; k++) {
        const i = comp[k];
        const x = i % W, y = (i - x) / W;
        const nb = [];
        if (x > 0)     nb.push(i - 1);
        if (x < W - 1) nb.push(i + 1);
        if (y > 0)     nb.push(i - W);
        if (y < H - 1) nb.push(i + W);
        for (const j of nb) {
          if (seen[j] && !bg[j]) continue;   // 同じ成分の内部
          border++;
          if (bg[j]) borderBg++;
        }
      }
      const floating = border > 0 && borderBg / border >= 0.9;

      if (!floating && ci < POCKET_MIN_AREA) continue;

      let dark = 0, light = 0;
      for (let k = 0; k < ci; k++) {
        const m = minCh[comp[k]];
        if (Math.abs(m - darkTone) <= POCKET_TONE_TOL) dark++;
        if (m >= tones.light - POCKET_TONE_TOL) light++;
      }
      if (floating || (dark / ci >= POCKET_MIN_DARK && light / ci >= POCKET_MIN_LIGHT)) {
        for (let k = 0; k < ci; k++) bg[comp[k]] = 1;
        pockets++; pocketPx += ci;
      } else {
        kept++; keptPx += ci;
      }
    }
  }

  return {
    bg, minCh, chroma, checker, edgeMin, tones,
    stats: { outerCleared, pockets, pocketPx, kept, keptPx }
  };
}

/**
 * 背景マスクを data のアルファへ焼き込み、フチをぼかす。data を破壊的に書き換える。
 * @param {number} edgeMin ぼかす対象の明度下限（computeBackground の戻り値を渡す）
 * @returns {number} ぼかした画素数
 */
function applyAlpha(data, W, H, C, bg, minCh, chroma, edgeMin) {
  const N = W * H;
  const lo = typeof edgeMin === 'number' ? edgeMin : 170;
  for (let i = 0; i < N; i++) if (bg[i]) data[i * C + 3] = 0;

  let feathered = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (bg[i]) continue;
      if (minCh[i] < lo || chroma[i] > EDGE_CHROMA) continue;
      const nb = (x > 0 && bg[i - 1]) || (x < W - 1 && bg[i + 1]) ||
                 (y > 0 && bg[i - W]) || (y < H - 1 && bg[i + W]);
      if (!nb) continue;
      const a = Math.round(255 * (255 - minCh[i]) / (255 - lo));
      data[i * C + 3] = Math.max(0, Math.min(255, a));
      feathered++;
    }
  }
  return feathered;
}

module.exports = { computeBackground, applyAlpha, detectChecker, readBackgroundTones };
