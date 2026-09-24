# my-portal-vault-proxy

`my-portal-vault`（GitHub Contents API）への読み書きを中継する Cloudflare Worker。
GitHub PAT をブラウザ・モバイルアプリから完全に隠すための「中間サーバー」。
仕組みの解説は `my-portal-vault` の `vault/knowledge/Cloudflare_Workersと中間サーバー学習ノート.md` を参照。

## デプロイ手順（Cloudflareアカウントへのログインが必要なため、本人作業）

前提: Node.js がインストール済みであること。

1. このディレクトリで依存関係をインストール
   ```bash
   cd worker-proxy
   npm install
   ```

2. Cloudflareアカウントにログイン（ブラウザが開くので許可する）
   ```bash
   npx wrangler login
   ```

3. Secret を2つ登録する（値はターミナルで直接入力する。ファイルには保存されない）
   ```bash
   npx wrangler secret put GITHUB_PAT
   # → my-portal-vault リポジトリへの Contents:write を持つ PAT を貼り付け

   npx wrangler secret put PORTAL_API_KEY
   # → アプリ⇄Worker間の合言葉。適当な長いランダム文字列でよい
   #   生成例（PowerShell）: -join ((48..57)+(97..122)|Get-Random -Count 40|%{[char]$_})
   ```

4. デプロイ
   ```bash
   npm run deploy
   ```

5. デプロイ後、`https://api.knowledgenote.work/api/vault/contents/vault/config.json` に
   `X-Portal-Key` ヘッダー付きでアクセスして疎通確認する（例: Postman や curl）。
   ```bash
   curl -H "X-Portal-Key: <手順3で決めた値>" https://api.knowledgenote.work/api/vault/contents/vault/config.json
   ```
   `vault/config.json` の中身が返れば成功。

## エンドポイント一覧

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/vault/contents/<path>?ref=<branch>` | ファイル取得・ディレクトリ一覧（GitHub Contents APIのレスポンスをそのまま透過） |
| PUT | `/api/vault/contents/<path>` | 作成・更新。body: `{content, message, branch?, sha?}` |
| DELETE | `/api/vault/contents/<path>` | 削除。body: `{message, sha, branch?}` |

すべてのリクエストに `X-Portal-Key: <PORTAL_API_KEYの値>` ヘッダーが必要。
`Origin` が `wrangler.toml` の `ALLOWED_ORIGINS` に含まれていないと CORS で弾かれる。

## 設定を変える場合

- 許可するオリジンを増やす／リポジトリ・ブランチを変える → `wrangler.toml` の `[vars]` を編集して再デプロイ
- Secret（PAT・合言葉）をローテーションする → 手順3を再実行（同名のSecretは上書きされる）

## 現状

- アプリ側（`portal-app/js/storage/github-storage.js`）はこのプロキシ経由に切り替え済み（2026-09-25）。
  GitHub PATはブラウザに一切存在しない
- 日報生成用の `POST /api/vault/dispatch/daily-report` エンドポイントは、呼び出し元
  （`daily-report.yml`・`js/core/github.js`）が既にデッドコードだったため両方とも削除済み。
  そのため `GITHUB_PAT` に必要なスコープも `Contents:write` のみで足りる（`Actions:write` は不要）
