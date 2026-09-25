# 表情差分画像の置き場

`scene.json` の `expressions[].file` が指す画像をここに置く。

```
neutral.png    通常（やわらかな微笑み）
happy.png      笑顔
excited.png    元気・テンション高め
gentle.png     優しい・慈しみ
thinking.png   考え中
worried.png    心配・困り
sad.png        しょんぼり
surprised.png  驚き
```

## 要件

- **背景は透過**（アルファ付き PNG）。背景は別レイヤー（`scene.json` の `backgrounds`）が描画する
  - 生成直後の画像は透過になっていない（市松模様が描き込まれるか白ベタになる）ので、
    必ず `tools/remove-generated-background.js` を通してから置く
- **長辺1200px・数百KB に収める**。全表情を起動時に先読みするため、原寸（6MB級）は置かない
- **円形フレームなし**。`avatar.png` にある白い丸枠は入れない
- **全ファイルで構図・服・髪・顔の大きさ・位置を揃える**。ズレると表情切替のたびに絵が跳ねて見える
- 縦長（3:4 程度）のバストアップ

## 未配置のときの挙動

置いていない表情は `avatar.png` を表示し、CSS の filter / transform による疑似表情で代用する。
1枚置くごとに、その表情だけ本物の差分に切り替わる（コード変更・設定変更は不要）。

生成用プロンプトはパック内の `../image-prompts.md` にある（persona-pack-spec §6-6）。
以前は vault 側に置いていてリポジトリ分割で参照が切れていたが、2026-08-12 に回収した。
