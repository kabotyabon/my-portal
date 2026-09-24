/**
 * 表情差分シートを1枚ずつに割るツール
 *
 *   npm i sharp --no-save
 *   node tools/split-expression-sheet.js <シート.png> <出力ディレクトリ> <名前1,名前2,...>
 *
 * 生成 AI に「表情差分を作って」と頼むと、1枚ずつではなく
 * 複数の表情が並んだ1枚のシートが返ってくることがある。しかもファイル名のラベル
 * （happy.png 等）が画像に焼き込まれている。これを個別の PNG に割る。
 *
 * 格子の位置は決め打ちしない。生成物の並びは不揃いで、行ごとに枚数も違うため。
 * 代わりに背景を抜いてから連結成分を取り、大きいものをキャラクター、
 * 小さいものを焼き込みラベル（文字）として捨てる。
 *
 * 手順
 *   1. tools/lib/transparent-bg.js で背景（市松 or 白ベタ）のマスクを求める
 *   2. 背景でない画素の連結成分を求める
 *   3. 面積の大きい上位 N 件（N = 渡した名前の数）をキャラクターとして採用し、
 *      残り（ラベルの文字）は背景に倒す
 *   4. 採用した成分を「上から下 → 左から右」に並べて名前を割り当てる
 *   5. それぞれの外接矩形で切り出し、共通のキャンバスへ同じ大きさに揃えて置く
 *
 * 5 の正規化は必須。「同一構図で」と指示しても生成物のキャラは 1〜2 割ずれた大きさで描かれ、
 * そのまま使うと表情を切り替えるたびに立ち絵が跳ねる。外接矩形の高さを揃え、
 * 下端合わせ・左右中央でキャンバスに置くことで、切り替えても動かなくなる。
 *
 * オプション
 *   --canvas 896x1200    出力キャンバス（既定 896x1200 / 既存のペルソナ画像に合わせた寸法）
 *   --char-height 0.9    キャンバス高に対するキャラの高さの比（既定 0.9）
 *   --bottom 0.03        下端の余白（キャンバス高に対する比・既定 0.03）
 *   --tight              正規化せず外接矩形のまま書き出す
 *
 * 出力ディレクトリの preview-on-dark/ に暗い背景へ合成したプレビューも書き出す。
 * 抜け残り・切れ・名前の取り違えを目視で確認してから配置すること。
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { computeBackground, applyAlpha } = require('./lib/transparent-bg');

const argv   = process.argv.slice(2);
const opt    = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const positional = argv.filter((a, i) =>
  !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && argv[i - 1] !== '--tight'));

const SHEET  = positional[0];
const DST    = positional[1];
const NAMES  = (positional[2] || '').split(',').map(s => s.trim()).filter(Boolean);

const TIGHT  = argv.includes('--tight');
const [CANVAS_W, CANVAS_H] = opt('canvas', '896x1200').split('x').map(Number);
const CHAR_RATIO   = parseFloat(opt('char-height', '0.9'));
const BOTTOM_RATIO = parseFloat(opt('bottom', '0.03'));

const PAD     = 24;    // 外接矩形に足す余白（px・元解像度基準）
const ROW_TOL = 0.5;   // 同じ行とみなす縦位置の差（成分の高さに対する割合）

if (!SHEET || !DST || NAMES.length === 0) {
  console.error('usage: node tools/split-expression-sheet.js <シート.png> <出力ディレクトリ> <名前1,名前2,...>'
    + '\n            [--canvas 896x1200] [--char-height 0.9] [--bottom 0.03] [--tight]');
  process.exit(1);
}

/** 背景でない画素の連結成分を列挙する（4近傍） */
function findComponents(bg, W, H) {
  const N = W * H;
  const seen = new Uint8Array(N);
  const queue = new Int32Array(N);
  const comps = [];

  for (let s = 0; s < N; s++) {
    if (bg[s] || seen[s]) continue;
    let qi = 0;
    seen[s] = 1; queue[qi++] = s;
    let minX = W, maxX = -1, minY = H, maxY = -1;
    const pixels = [];

    for (let k = 0; k < qi; k++) {
      const i = queue[k];
      const x = i % W, y = (i - x) / W;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      pixels.push(i);
      if (x > 0     && !bg[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; queue[qi++] = i - 1; }
      if (x < W - 1 && !bg[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; queue[qi++] = i + 1; }
      if (y > 0     && !bg[i - W] && !seen[i - W]) { seen[i - W] = 1; queue[qi++] = i - W; }
      if (y < H - 1 && !bg[i + W] && !seen[i + W]) { seen[i + W] = 1; queue[qi++] = i + W; }
    }
    comps.push({ area: qi, minX, maxX, minY, maxY, pixels });
  }
  return comps;
}

/** 上から下 → 左から右。行の折り返しは成分の高さを基準に判定する */
function sortReadingOrder(comps) {
  const medianH = comps.map(c => c.maxY - c.minY).sort((a, b) => a - b)[Math.floor(comps.length / 2)];
  const sorted = [...comps].sort((a, b) => a.minY - b.minY);
  const rows = [];
  for (const c of sorted) {
    const row = rows.find(r => Math.abs(r[0].minY - c.minY) <= medianH * ROW_TOL);
    if (row) row.push(c); else rows.push([c]);
  }
  rows.forEach(r => r.sort((a, b) => a.minX - b.minX));
  return rows.flat();
}

async function preview(buf, outPath) {
  const m = await sharp(buf).metadata();
  const bgImg = await sharp({
    create: { width: m.width, height: m.height, channels: 4, background: '#1a0b2e' }
  }).png().toBuffer();
  await sharp(bgImg).composite([{ input: buf }]).png().toFile(outPath);
}

(async () => {
  const { data, info } = await sharp(SHEET).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  console.log(`シート: ${W}x${H}`);

  const { bg, minCh, chroma, checker, edgeMin, stats } = computeBackground(data, W, H, C);
  console.log(`市松=${checker ? `検出(切替${checker.switches}回)` : 'なし（白ベタ）'}`
    + ` 外側=${(stats.outerCleared / (W * H) * 100).toFixed(1)}%`
    + ` 閉領域抜き=${stats.pockets}件/${stats.pocketPx}px`);

  const comps = findComponents(bg, W, H).sort((a, b) => b.area - a.area);
  console.log(`連結成分 ${comps.length}件 / 面積上位: ` + comps.slice(0, NAMES.length + 3).map(c => c.area).join(', '));

  if (comps.length < NAMES.length) {
    console.error(`成分が ${comps.length} 件しかありません（名前は ${NAMES.length} 件）`);
    process.exit(1);
  }

  const chosen = comps.slice(0, NAMES.length);
  const dropped = comps.slice(NAMES.length);
  const smallest = chosen[chosen.length - 1].area;
  const largestDropped = dropped.length ? dropped[0].area : 0;
  console.log(`採用 ${chosen.length}件（最小 ${smallest}px） / 捨てる ${dropped.length}件（最大 ${largestDropped}px）`);
  if (largestDropped > smallest * 0.2) {
    console.warn('⚠ 採用の最小と不採用の最大が近すぎます。名前の数が合っているか確認してください');
  }

  // ラベルなど採用しなかった成分は背景に倒す（切り出し範囲に入り込むため）
  for (const c of dropped) for (const i of c.pixels) bg[i] = 1;

  applyAlpha(data, W, H, C, bg, minCh, chroma, edgeMin);

  fs.mkdirSync(DST, { recursive: true });
  fs.mkdirSync(path.join(DST, 'preview-on-dark'), { recursive: true });

  const ordered = sortReadingOrder(chosen);
  let total = 0;

  const charH = Math.round(CANVAS_H * CHAR_RATIO);
  const bottomMargin = Math.round(CANVAS_H * BOTTOM_RATIO);
  if (!TIGHT) {
    console.log(`正規化: キャンバス ${CANVAS_W}x${CANVAS_H} / キャラ高 ${charH}px / 下余白 ${bottomMargin}px`);
  }

  for (let n = 0; n < ordered.length; n++) {
    const c = ordered[n];
    const name = NAMES[n].endsWith('.png') ? NAMES[n] : `${NAMES[n]}.png`;

    // 外接矩形そのもの（余白なし）。正規化の基準にするため PAD は含めない
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;

    let buf, note;
    if (TIGHT) {
      const left   = Math.max(0, c.minX - PAD);
      const top    = Math.max(0, c.minY - PAD);
      const right  = Math.min(W - 1, c.maxX + PAD);
      const bottom = Math.min(H - 1, c.maxY + PAD);
      buf = await sharp(data, { raw: { width: W, height: H, channels: C } })
        .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
        .png({ compressionLevel: 9, effort: 10 })
        .toBuffer();
      note = `外接(${bw}x${bh})`;
    } else {
      // 外接矩形の高さを charH に合わせて拡縮し、下端合わせ・左右中央でキャンバスに置く
      const scale = charH / bh;
      const scaledW = Math.max(1, Math.round(bw * scale));
      const cropped = await sharp(data, { raw: { width: W, height: H, channels: C } })
        .extract({ left: c.minX, top: c.minY, width: bw, height: bh })
        .resize({ width: scaledW, height: charH, fit: 'fill' })
        .png()
        .toBuffer();

      const leftPos = Math.round((CANVAS_W - scaledW) / 2);
      const topPos  = CANVAS_H - bottomMargin - charH;
      if (scaledW > CANVAS_W) {
        console.warn(`  ⚠ ${name}: 拡縮後の幅 ${scaledW}px がキャンバス幅 ${CANVAS_W}px を超えます`);
      }

      buf = await sharp({
        create: { width: CANVAS_W, height: CANVAS_H, channels: 4,
                  background: { r: 0, g: 0, b: 0, alpha: 0 } }
      })
        .composite([{ input: cropped, left: Math.max(0, leftPos), top: Math.max(0, topPos) }])
        .png({ compressionLevel: 9, effort: 10 })
        .toBuffer();
      note = `外接(${bw}x${bh}) x${scale.toFixed(3)} → 幅${scaledW}`;
    }

    fs.writeFileSync(path.join(DST, name), buf);
    await preview(buf, path.join(DST, 'preview-on-dark', name));
    total += buf.length;

    const m = await sharp(buf).metadata();
    console.log(`  ${name.padEnd(15)} ${note.padEnd(34)} → ${m.width}x${m.height} ${(buf.length / 1024).toFixed(0)}KB`);
  }
  console.log('--- 合計', (total / 1048576).toFixed(2) + 'MB');
})();
