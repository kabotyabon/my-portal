/**
 * アバター表情差分の下処理ツール
 *
 *   npm i sharp --no-save        # package.json は汚さない
 *   node tools/remove-generated-background.js <入力ディレクトリ> <出力ディレクトリ>
 *
 * 生成直後の画像（1792x2400・約6MB）を、背景透過・長辺1200px・約330KB に変換する。
 * 出力ディレクトリの preview-on-dark/ に暗い背景へ合成したプレビューも書き出すので、
 * 抜け残りやフチの白浮きを目視で確認してから vault/persona/<セット>/expressions/ へコピーする。
 *
 * 1枚に複数の表情が並んだシートが返ってきた場合は、先に
 * tools/split-expression-sheet.js で1枚ずつに割ってから使う。
 *
 * 背景を透過にする処理そのものは tools/lib/transparent-bg.js にある。
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { computeBackground, applyAlpha } = require('./lib/transparent-bg');

const SRC = process.argv[2];
const DST = process.argv[3];
const TARGET_H = 1200;

async function process1(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const N = W * H;

  const { bg, minCh, chroma, checker, edgeMin, stats } = computeBackground(data, W, H, C);
  const feathered = applyAlpha(data, W, H, C, bg, minCh, chroma, edgeMin);

  const buf = await sharp(data, { raw: { width: W, height: H, channels: C } })
    .resize({ height: TARGET_H, withoutEnlargement: true })
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();

  return {
    buf, W, H, N, feathered, ...stats,
    checker: checker ? `検出(切替${checker.switches}回)` : 'なし（白ベタ）',
    meta: await sharp(buf).metadata()
  };
}

async function preview(buf, outPath) {
  const m = await sharp(buf).metadata();
  const bgImg = await sharp({
    create: { width: m.width, height: m.height, channels: 4, background: '#1a0b2e' }
  }).png().toBuffer();
  await sharp(bgImg).composite([{ input: buf }]).png().toFile(outPath);
}

(async () => {
  fs.mkdirSync(DST, { recursive: true });
  fs.mkdirSync(path.join(DST, 'preview-on-dark'), { recursive: true });
  let total = 0;
  for (const f of fs.readdirSync(SRC).filter(x => x.toLowerCase().endsWith('.png'))) {
    const r = await process1(path.join(SRC, f));
    fs.writeFileSync(path.join(DST, f), r.buf);
    await preview(r.buf, path.join(DST, 'preview-on-dark', f));
    total += r.buf.length;
    console.log(
      f.padEnd(14),
      `${r.meta.width}x${r.meta.height}`,
      `市松=${r.checker}`,
      `外側=${(r.outerCleared / r.N * 100).toFixed(1)}%`,
      `閉領域抜き=${r.pockets}件/${r.pocketPx}px`,
      `保護=${r.kept}件/${r.keptPx}px`,
      `フチ=${r.feathered}px`,
      `${(r.buf.length / 1024).toFixed(0)}KB`
    );
  }
  console.log('--- 合計', (total / 1048576).toFixed(2) + 'MB');
})();
