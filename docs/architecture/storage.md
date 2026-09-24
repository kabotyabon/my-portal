# ストレージと同期

## いまの仕様

### GitHub Contents API ＋ 中間サーバー（Cloudflare Workers プロキシ）経由の読み書き

ストレージの実体は変わらずGitHub Contents API（Markdown/JSONファイル）。ただし**ブラウザは2026-09-25以降、
GitHubへ直接アクセスしない**。`worker-proxy/`（Cloudflare Workers、`api.knowledgenote.work`）が中継し、
GitHub PATはこのWorkerのSecretとしてのみ存在する。

- データはすべて Markdown / JSON ファイルとして保存され、Git の履歴・差分・バックアップが自動的に付いてくる
- 全読み書きは `js/storage/github-storage.js` を唯一の出口とする（`getFile` / `saveFile` / `deleteFile` / `listFiles`）。
  内部実装が「GitHubへ直接」から「Workerプロキシ経由」に変わっただけで、呼び出し側（リポジトリ層・ツール層）は無変更
- ドメイン層は `js/storage/*-repository.js` のリポジトリ層を挟んでおり、将来ストレージを差し替える場合の境界はここ
- 制約: 全文検索・集計はファイル一覧＋クライアント側フィルタリングになる。API レートリミットは認証済みで 5000 回/時

### 2リポジトリ構成と中間サーバー

| リポジトリ／サービス | 可視性 | 中身 |
|---|---|---|
| `my-portal` | public | `portal-app/`（アプリ本体）・`worker-proxy/`（中間サーバーのコード）・`tools/`・ルート設定 |
| `my-portal-vault` | private | `vault/` 全部（日記・会話ログ・ナレッジ・タスク・本ドキュメント） |
| Cloudflare Workers（`api.knowledgenote.work`） | — | `worker-proxy/` をデプロイした中間サーバー本体。GitHub PATを保持する唯一の場所 |

「公開してはいけないものが公開側に入る」を、レビューではなく GitHub の権限設定（リポジトリ境界）で防ぐ。どちらのリポジトリにあるかは一目で判定できるため、除外設定の正しさを人間の注意力で保証し続ける必要がない。

- 接続先は `js/storage/github-storage.js` の `PROXY_BASE`（`https://api.knowledgenote.work`）に固定。リポジトリ名・ブランチはWorker側の環境変数（`GITHUB_REPO`/`GITHUB_BRANCH`）で固定されており、クライアントは知らない・渡さない（旧 `portal-config.json` / `getRepo()` / `getBranch()` は廃止）
- クライアント⇄Worker間の認証は「アクセスキー」（`X-Portal-Key`ヘッダー。Workerの`PORTAL_API_KEY`と一致させる）。GitHub PATとは無関係の、Worker専用の合言葉
- Worker⇄GitHub間はWorkerが保持する`GITHUB_PAT`（Contents:write / Actions:write）で認証する。ブラウザ・モバイルアプリはこのPATを一切持たない
- 中間サーバーのコード・デプロイ手順は `worker-proxy/README.md`、仕組みの解説は `my-portal-vault` の `vault/knowledge/Cloudflare_Workersと中間サーバー学習ノート.md`

### 認証情報の保存方式

**アクセスキー**（`portal_api_key`）と Gemini API キーは素の `localStorage` に平文で保存する（`js/ui/settings.js`）。
GitHub PATはブラウザに一切保存しない（Cloudflare WorkerのSecretにのみ存在）。

- パスフレーズ暗号化（PBKDF2 + AES-GCM）は一度導入して廃止した。得られる保護が「端末放置時にストレージビューアから読まれるリスクの低減」だけ（XSS には元から無力）なのに対し、起動のたびの解錠が重すぎた
- 平文保存は静的 HTML アプリの限界として正式に受け入れている（アクセスキーはWorker専用の合言葉であり、漏れてもGitHubアカウント自体には影響しない点がGitHub PAT直持ちより安全）
- 旧暗号化状態の掃除処理（`_enc` キーの破棄・`sessionStorage` からの移行）は `settings.js` に残してある
- 中間サーバー移行に伴い、旧GitHub PATの残骸（`gh_pat`・`github_pat_token`）は起動時に`js/core/config.js`が自動で破棄する

### 競合制御（楽観的ロック）

- `saveFile()` の既定挙動は「書き込み直前に最新 SHA を取り直して送る」＝必ず通る上書き
- `opts.baseSha` を渡すと楽観的ロックになり、読んだ時点から中身が変わっていれば GitHub が 409/422 で拒否し、`GitHubConflictError` を投げる
- 原則は「**黙ってリトライしない**」。衝突時に同じ本文を再送しても lost update は救えない——SHA だけ取り直して再送していたことが、かつて会話ログの発話を消した不具合の正体だった
- 衝突は呼び出し側に返し、呼び出し側が読み直して組み立て直す。会話ログの追記（`_appendToFile`）は最大3回、試行ごとに `getFile()` からやり直す
- `baseSha` を使っているのは会話ログのみ。日記・設定・タスク・AI ツール経由の書き込みは既定の上書き挙動のまま（画面で中身を見ながら編集するため危険度が低い、という判断を維持）

### 書き込みツールの規約（AI エージェント）

- **追記は `append_to_file` を優先する。**
  - 「読む→つなぐ→書く」の3手をアプリ側（`js/agent/tool-dispatcher.js`）でやり、AI は追記したい文章だけを渡す
  - AI に3手を任せると read を飛ばして丸ごと上書きする事故が実際に起きた
- **`save_file` は全置換**であり、上書きガードが付く。
  - この往復で `read_file` していないパスに対し、既存の全文を含まない内容を書こうとすると拒否する
  - 判定は長さではなく「既存の全文が新しい内容に残っているか」（長くなりながら中身を失う事故があったため）
  - `read_file` したパスは往復単位で記録し、`beginTurn()` が毎回リセットする
- **書き込み系ツールの結果は `{ ok, ... }` 形式**で返す。
  - 成功の目印がない生レスポンスでは AI が成否を判別できず、「保存した」と虚偽報告する往復が起きた
  - 書き込み前後の blob SHA を突き合わせ、内容が変わっていない空コミット（＝追記したつもりが元のまま）も `ok: false` として返す

## 変遷

- **2026-09-25** ブラウザから直接GitHubを叩く方式を廃止し、中間サーバー（Cloudflare Workers、`worker-proxy/`）
  経由に切り替えた。`js/storage/github-storage.js`を全面書き換え（呼び出し側のAPIは無変更）、GitHub PATを
  ブラウザから完全に排除。あわせて不要になった `portal-config.json`・`getRepo()`/`getBranch()`・
  `js/core/github.js`（日報生成の`workflow_dispatch`呼び出し。report.jsの`regenReport()`に上書きされ
  実質デッドコードだったと判明）を削除した。設定画面の項目名も「GitHub PAT」から「アクセスキー」に変更
- **2026-08-08** パスフレーズ暗号化を廃止し、キーは素の localStorage に戻した。`secure-store.js`（215行）ごと削除。既定オフで残す案は採らなかった: 使わない機能のコードを抱え続け、判断の再検討が繰り返し発生する
- **2026-08-06** 同時書き込みの lost update を修正。`saveFile()` に `baseSha`（楽観的ロック）を追加し、衝突は `GitHubConflictError` で呼び出し側に返す。会話ログは読み直して再送する。会話ログの1往復1ファイル化は採らなかった: 衝突が検出できるようになった以上、読み書きの形を変えるほどの理由がない
- **2026-08-06** 公開面と非公開面をリポジトリ境界で分離。`my-portal`（public）と `my-portal-vault`（private）に分け、どちらも履歴を捨てて1コミットから作り直した（旧933コミットの archive も同日削除）。アプリ側の変更は3箇所のみ。`git filter-repo` での履歴書き換えは採らなかった: 消し漏れがないことを証明できない
- **2026-08-05** AI が日記を丸ごと上書きする事故（2日連続）を受け、`append_to_file` ツールを新設し `save_file` に上書きガードを付けた。ツール説明文の強化は採らなかった: 既に書いてあって守られなかった
- **2026-08-03** 2台同時使用で会話ログの発話が消える lost update を再現・記録。当初は「1台なら安全・履歴から戻せる」として保留したが、リポジトリ分割で履歴が消えて前提が崩れ、8/6 に修正
- **2026-07 頃まで** 構造的変更を ADR 先行で記録する「ADR 駆動」を管理手法としていた。本ハンドブックへの移行（2026-08）でこの運用は廃止
- **2026-04-07** D1 移行は音声機能追加まで延期。今すぐの移行は採らなかった: D1 を使う機能（全文検索・集計）がまだ存在しない
- **2026-04-07** PAT + リポジトリ設定で API 接続先を決める方式を決定。当初の「work / personal 複数プロファイル切り替え」は未実装のまま廃止され（仕事用は別ポータルへ分離）、プロファイル1本に縮小した形で現行の土台になった。サーバーサイド認証（OAuth / Cloudflare Access）は採らなかった: バックエンドなしで実現できる方を優先
- **2026-04-07** GitHub Contents API をプライマリストレージに採用。localStorage のみ・Firebase / Supabase は採らなかった: 同期がない・外部サービス依存になる。D1 は Workers が必要で今フェーズには過大

## 既知の問題・残課題

- **D1 移行は保留中**。着手条件は「音声入力機能の追加」「日記ファイル500件超で検索が遅くなる」「月次集計など集計クエリが必要になる」のいずれか。いずれも未達。なお当初計画の `storage/interface.ts`（StorageAdapter）は作らず、`js/storage/*-repository.js` のリポジトリ層が差し替え境界を代替している
- **ポータル本体（GitHub Pages配信）とペルソナ画像の中継は、まだCloudflareへ移していない。** 今回整備したのは「GitHub Contents APIへの中間サーバー」だけで、ポータル自体のホスティング・private化はスコープ外（demo-deploy.mdの残課題を参照）
- **`daily-report.yml`（GitHub Actions）は使われなくなった。** 呼び出し元だった`js/core/github.js`を削除したため、このワークフロー自体を`my-portal-vault`から削除するか判断が必要（削除するなら`Actions: write`のPATスコープも不要になる）
- **楽観的ロックは会話ログのみ**。日記・設定・タスク・AI ツール（`tool-dispatcher.js`）経由の書き込みは既定の上書き挙動のままで、2台同時編集では理屈上 lost update が起こりうる
- **楽観的ロックのブラウザ上での実動作は未確認**（検証はスタブによる `tools/verify-append-conflict.mjs` のみ）
- **`save_file` の上書きガードは往復をまたげない**。前の往復で読んでいても次の往復では「読んでいない」扱い（安全側）
- **`append_to_file` は末尾追記のみ**。セクション指定の追記が必要になったら `upsertSectionInContent()` 相当のツール化を検討する
- **旧履歴（933コミット）は失われている**。データが消えた場合に git 履歴から復元できるのは 2026-08-06 以降の分だけ
- **ファイル削除とキャッシュの問題**。`index.html` 自体が `max-age=600` でキャッシュされるため、ファイル削除を伴う変更は最低10分の猶予が要る。恒久対策（コンテンツハッシュ）にはビルド工程が必要で、Workers 移行以降の課題
