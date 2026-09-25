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

- **正式な公開URLは `https://app.knowledgenote.work/`（2026-09-25〜、Cloudflare Workers Static Assets配信）**
- 旧URL `…/my-portal/portal-app/`（GitHub Pages）も並行して生きている（`.github/workflows/deploy-pages.yml`は現役のまま）。ミラー・避難先として残す
- 2つの公開URLはブラウザのオリジンが別なので、**localStorage（アクセスキー・Geminiキー・下書き）は共有されない**。どちらでも初回は設定し直しが必要
- TWA・PWAは今後 `app.knowledgenote.work` を正として使う

### Cloudflare Workers Static Assets デプロイ（`web-deploy/`）

`portal-app/` をビルド工程なしでそのままCloudflare Workers（Static Assets機能）配信する。GitHub Pagesと同じ「ビルドなしの静的配信」だが、独自ドメイン（`app.knowledgenote.work`）で提供できる。

- 設定は `web-deploy/wrangler.toml`。`[assets].directory` が `../portal-app` を指すだけの薄い構成（`worker-proxy/`とは別プロジェクト）
- デプロイは手動 `npx wrangler deploy`（`web-deploy/`内で実行）。GitHub Pagesのような push時自動デプロイのCI連携はまだ無い
- 中間サーバー（`worker-proxy/`）の`ALLOWED_ORIGINS`に`https://app.knowledgenote.work`を追加済み。新しい配信元を増やす場合はここも忘れずに更新する
- `wrangler pages`系コマンド（Cloudflare Pages）は使わず、Cloudflare公式が推奨する「Workers + Static Assets」方式を採用（2026-09時点でwranglerもPagesより Workers方式を案内する）

### キャッシュバスト運用（注意）

- JS の更新は `?v=` の手動更新で反映する。**上げ忘れると古い定義のまま動く**
- `index.html` 自体が `max-age=600` でキャッシュされる。古い index.html → 古い app.js → 削除済みファイルを fetch → 404、という経路は `?v=` では防げない
- したがって**ファイル削除を伴う変更には最低10分の猶予を見込む**。`?v=` は「新しいファイルを取りに行かせる」仕組みであって、「古いコードが古いファイルを探すこと」は防げない

### PWA

ブラウザの「ホーム画面に追加」でアプリとしてインストールできる（`portal-app/manifest.json`）。

- アイコン（192/512/512 maskable）を`assets/icons/`に用意済み（2026-09-25）。生成スクリプトは`tools/generate-icons.ps1`（.NET System.Drawingで直接描画。三日月＋夜のグラデーション、Ambient Companionのテーマカラー準拠）
- アイコン追加により、Android Chromeでの正式な「インストール」導線（`beforeinstallprompt`）が機能する条件が揃った

### 中間サーバー（Cloudflare Workers プロキシ）— デプロイ済み・アプリ側は未接続

Web/モバイルの分離（モバイルはTWA→React Native、Web版はNext.js化を検討中）に伴い、
GitHub PAT をクライアント（ブラウザ・将来のモバイルアプリ）に置けなくなるため、
GitHubへの読み書きを中継する薄いプロキシを `worker-proxy/` に実装し、Cloudflareへデプロイした。

- Cloudflare Workers上で動く。GitHub PATは Worker の Secret（`GITHUB_PAT`）としてのみ保持し、クライアントには渡さない
- クライアント⇄Worker間は別の合言葉（Secret `PORTAL_API_KEY`、`X-Portal-Key`ヘッダーで送る）で認証する（GitHub PATとは無関係）。
  比較時は両辺をtrimする（`wrangler secret put`へのCLI入力経路によっては末尾に改行が混入しうるため）
- エンドポイントは `GET/PUT/DELETE /api/vault/contents/<path>` と `POST /api/vault/dispatch/daily-report` の2系統。
  GitHub Contents APIのレスポンスをほぼ透過するだけの薄い設計（詳細は `worker-proxy/README.md`）
- ドメイン `knowledgenote.work` を取得・Cloudflareへネームサーバー移行済み（2026-09-24）。
  Workerは **`api.knowledgenote.work` にカスタムドメインで紐付け済み**（デプロイ・疎通確認済み、2026-09-25）。
  Cloudflareのカスタムドメインはワイルドカード・パス付きパターンを許可しないため、`wrangler.toml`の`routes`は
  ホスト名のみ（`api.knowledgenote.work`、末尾に`/*`を付けない）で書くこと
- **`portal-app` 側をこのプロキシ経由に差し替える変更はまだ未着手**。今の `portal-app` は引き続きブラウザから
  直接GitHubを叩いており、PATはブラウザに残ったまま。プロキシ自体は疎通確認済みで、あとはアプリ側の接続変更のみ

旧来の「ホスティングごとCloudflareへ移しポータルをAccessで閉じる」という構想（下記2026-08-08の変遷）とは
**スコープを分離**した。まず「PATを隠す」ことだけを独立したWorkerで解決し、ポータル自体の配信先
（GitHub Pagesのまま続けるか、Web版のNext.js化にあわせてCloudflare Pages/Workersへ移すか）は別途判断する。

## 変遷

- **2026-09-25** — ポータル本体（`portal-app/`）をCloudflare Workers Static Assetsで`app.knowledgenote.work`へ
  デプロイ（`web-deploy/`）。TWA化にあたり、GitHub Pages（`kabotyabon.github.io`）ではなく取得済みの独自ドメインを
  使いたいという要望から。当初`wrangler pages project create`で試みたところ、リポジトリルート全体を
  アセット化しようとして`package.json`等を巻き込む挙動になったため中断・リポジトリを復元し、`web-deploy/`という
  独立ディレクトリから`wrangler deploy`（Cloudflare公式が現在案内するWorkers + Static Assets方式。Pages専用コマンドは
  不採用）で`portal-app/`だけを配信する構成に切り替えた。中間サーバーの`ALLOWED_ORIGINS`に新オリジンを追加し
  疎通確認（対話・日記・メモの実データ取得）まで完了。GitHub Pagesは並行稼働のまま残す
- **2026-09-25** — 中間サーバー（`worker-proxy/`）をCloudflareへデプロイし、`api.knowledgenote.work`への
  カスタムドメイン紐付けと疎通確認（`vault/config.json`取得）まで完了。Volta経由でNode.js/npmを導入し、
  wranglerの依存（esbuild/sharp/workerd）のinstall scriptsを承認して環境構築。カスタムドメインの
  `routes`にワイルドカード（`/*`）を付けるとデプロイが拒否される点、`X-Portal-Key`比較はCLI入力時の
  改行混入に備えて両辺trimが必要だった点を実装中に確認。`portal-app` 側の接続変更はまだ
- **2026-09-24** — GitHub PATを隠す中間サーバー（`worker-proxy/`、Cloudflare Workers）のコードを実装。
  ドメイン `knowledgenote.work` を取得しCloudflareへネームサーバー移行済み。ポータル本体の
  ホスティング移行とは切り離し、PATを隠すことだけを先に解決する方針にした（Web/モバイル分離のため
  データ層プロキシが両トラックの前提になる）
- **2026-08-12** — デモモードを追加。`?demo`・台本エンジン `demo-script.js`・パック仕様に `demo.json`（任意）を追加（ADRなし。コードと README が一次情報）
- **2026-08-08** — 「ファイル削除は JS のキャッシュバストで守れない」ことを記録。`card.json` 移行時に古い index.html が削除済み `persona.md` を探して人格が消える事故が起きた。削除は10分の猶予を見込む運用とし、恒久対策はコンテンツハッシュ（ビルド工程）に持ち越し
- **2026-08-08** — ホスティングを Cloudflare（Workers + Static Assets）へ移し、ポータルを Access で閉じることを決定。Cloudflare アカウントと独自ドメインの取得待ちで**保留**
- **2026-08-06** — 公開面と非公開面をリポジトリ境界で分離。アプリは public `my-portal`、データは private `my-portal-vault`。`deploy-pages.yml` の `path: '.'` は据え置き（公開側に `vault/` が無くなり実害がないため。絞ると Pages のルートが変わり PWA の `start_url` に影響する）

## 既知の問題・残課題

- **中間サーバーはデプロイ・疎通確認済みだが未接続。** `worker-proxy/`はCloudflareへデプロイ済み・`api.knowledgenote.work`経由で動作確認済み。残るのは `portal-app` 側のGitHub直叩き箇所（`js/storage/github-storage.js`・`js/core/github.js`）をこのプロキシ経由へ差し替える変更のみ。それが終わるまでPATはブラウザに残ったまま
- **wranglerのメジャーバージョンが古い（3.114.17、4系が最新）。** 実害は今のところ無いが、次にWorkerを触るときにアップデートを検討する
- **ポータル本体のCloudflare移行（ホスティング・Access化）は保留のまま。** 上記の中間サーバーとは別の話。着手時の地雷は整理済み: オリジン変更で localStorage（PAT・APIキー・下書き）が全消え／PWA は入れ直し／`workers.dev` を塞がないと Access が素通し／Access + iOS PWA の相性は最初に実機検証
- **コンテンツハッシュ（ビルド工程）未導入。** ファイル削除を伴う変更は「10分の猶予」という運用でしのいでいる。ビルド工程は Cloudflare 移行時の CI 作り直しとあわせて検討
- **`deploy-pages.yml` の `path: '.'`。** 現状実害は無いが、絞る場合は `manifest.json` とセットで行うこと
