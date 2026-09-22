# デモとデプロイ

## いまの仕様

### デモモード（?demo）

公開URLに `?demo` を付けて開くと、PAT・APIキーなしでアバターとの対話を体験できる。

- **「体験は本物、LLMだけスタブ」が設計方針。** Gemini の呼び出しだけを台本（`demo.json`）に差し替え、表情・背景・候補タグの解析、ページ送り、立ち絵の描画は本番と同じパイプラインをそのまま通す（`portal-app/js/domains/demo-script.js`）
- ルーティングは「返信候補ボタンの文言 → ノードid」の**完全一致のみ**。自由入力には fallback を返す。賢くしない（賢い返事は本番の仕事）
- **データはどこにも保存されない。** 画面上部にデモバナーを常時表示し、本セットアップへの導線を置く
- 案内役は専用ペルソナ「こまる」（`portal-app/assets/_komaru/`）。使用中のペルソナとは独立
- 台本の口調は人格に属するため、`demo.json` はコードではなくペルソナパックが持つ（仕様は `docs/persona-pack-spec.md` §3.5）。パックに無い・壊れているときはアプリ内蔵の汎用台本に落ちる
- 即答だと「考えています…」が点滅して見えるため、返答には 700ms の擬似的な間を置く

### GitHub Pages デプロイ

`main` への push（または手動の workflow_dispatch）で `.github/workflows/deploy-pages.yml` が走る。

- ビルド工程は無い。リポジトリ全体（`path: '.'`）をそのまま artifact 化して GitHub Pages に載せる2ジョブ構成（build → deploy）
- `concurrency: group "pages"` で同時デプロイを直列化する
- 公開リポジトリ `my-portal` に `vault/` は存在しないため、`path: '.'` でも個人データは公開面に出ない（データは private の `my-portal-vault` を Contents API で読み書きする）

### 公開URL

- 公開URLは `…/my-portal/portal-app/`。旧 `…/my-portal/` からは自動転送される（ホーム画面に追加済みでも開き直せば転送される）

### キャッシュバスト運用（注意）

- JS の更新は `?v=` の手動更新で反映する。**上げ忘れると古い定義のまま動く**
- `index.html` 自体が `max-age=600` でキャッシュされる。古い index.html → 古い app.js → 削除済みファイルを fetch → 404、という経路は `?v=` では防げない
- したがって**ファイル削除を伴う変更には最低10分の猶予を見込む**。`?v=` は「新しいファイルを取りに行かせる」仕組みであって、「古いコードが古いファイルを探すこと」は防げない

### PWA

ブラウザの「ホーム画面に追加」でアプリとしてインストールできる（`portal-app/manifest.json`）。

## 変遷

- **2026-08-12** — デモモードを追加。`?demo`・台本エンジン `demo-script.js`・パック仕様に `demo.json`（任意）を追加（ADRなし。コードと README が一次情報）
- **2026-08-08** — 「ファイル削除は JS のキャッシュバストで守れない」ことを記録。`card.json` 移行時に古い index.html が削除済み `persona.md` を探して人格が消える事故が起きた。削除は10分の猶予を見込む運用とし、恒久対策はコンテンツハッシュ（ビルド工程）に持ち越し
- **2026-08-08** — ホスティングを Cloudflare（Workers + Static Assets）へ移し、ポータルを Access で閉じることを決定。Cloudflare アカウントと独自ドメインの取得待ちで**保留**
- **2026-08-06** — 公開面と非公開面をリポジトリ境界で分離。アプリは public `my-portal`、データは private `my-portal-vault`。`deploy-pages.yml` の `path: '.'` は据え置き（公開側に `vault/` が無くなり実害がないため。絞ると Pages のルートが変わり PWA の `start_url` に影響する）

## 既知の問題・残課題

- **Cloudflare 移行は決定済み・未着手。** 着手条件はアカウントと独自ドメインの取得。着手時の地雷も整理済み: オリジン変更で localStorage（PAT・APIキー・下書き）が全消え／PWA は入れ直し／`workers.dev` を塞がないと Access が素通し／Access + iOS PWA の相性は最初に実機検証
- **コンテンツハッシュ（ビルド工程）未導入。** ファイル削除を伴う変更は「10分の猶予」という運用でしのいでいる。ビルド工程は Cloudflare 移行時の CI 作り直しとあわせて検討
- **`deploy-pages.yml` の `path: '.'`。** 現状実害は無いが、絞る場合は `manifest.json` とセットで行うこと
