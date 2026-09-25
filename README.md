# My Portal

個人用ポータルサイトです。日記（日報）の表示・編集、メモ、AI チャット（Gemini）などの機能を提供します。タスクは `vault/task/tasks.json` でファイル管理し、AI チャットのツール経由で操作します。

> **2026-09-22**: 3D アバター＋音声（[Perxona Connect Kit](https://connect.perxona.ai/)）を統合した。設定画面の「3D アバター・音声」で Publishable Key を設定すると有効になり、未設定・オフ・初期化失敗時は従来の 2D 立ち絵にフォールバックする。
> これまで別リポジトリ（`my-portal-Perxona`）で試していたが、本体側の修正が追随しない問題があったため、この `my-portal` に統合し、以後はここを唯一の開発元とする。`my-portal-Perxona` は更新を止め、README にこちらへの案内を残す予定。
> Perxona 固有のファイル: `portal-app/js/core/perxona-config.js` / `portal-app/js/presenter/perxona-stage.js` / `portal-app/js/ui/perxona-settings.js` / `portal-app/css/perxona.css` / `portal-app/avatars.html`（アバター一覧）。

## リポジトリ構成

**アプリ（公開）とデータ（非公開）を別リポジトリに分けています**。

| リポジトリ | 可視性 | 中身 |
|---|---|---|
| `my-portal`（このリポジトリ） | public | 静的Webアプリのコード |
| `my-portal-vault` | private | 日記・ナレッジ・会話ログ・タスク・設計ドキュメント |

アプリは実行時に GitHub Contents API（PAT 付き）でデータリポジトリを読み書きします。ビルド工程はありません。

```
my-portal/                     ← このリポジトリ（public）
├── portal-app/                ← 静的Webアプリ本体
│   ├── index.html / css / js / partials / manifest.json
│   └── assets/avatars/<slug>/   ← キャラクターの見た目（立ち絵・scene.json。一覧は index.json、仕様は docs/persona-pack-spec.md）
├── worker-proxy/              ← 中間サーバー（Cloudflare Worker、api.knowledgenote.work）。GitHub PATはここにだけある
├── web-deploy/                ← portal-app を app.knowledgenote.work へ配信する設定
├── docs/architecture/         ← 設計ドキュメント（テーマ別ハンドブック）。入口は README.md、決定の時系列は decisions.md
├── tools/                     ← 画像下処理・アイコン生成スクリプト（アプリからは呼ばない）
└── index.html                 ← 旧URL → portal-app/ へのリダイレクト

my-portal-vault/               ← データリポジトリ（private・Contents API 経由で参照）
└── vault/
    ├── diary/                 ← 日記（当月: YYYY-MM-DD.md / 過去月: YYYY/YYYY-MM.md）
    ├── conversations/         ← アバターとの会話ログ（自動追記）
    ├── knowledge/             ← ナレッジ
    ├── persona/card.json      ← 人格の定義（vault につき1つ）
    ├── persona-state/         ← ユーザーの記憶
    ├── task/                  ← タスク・メモ（tasks.json / memo.md）
    └── config.json            ← アプリ設定
```

> **キャラクターの見た目（画像・scene.json）だけは公開リポジトリ側にあります。** 人格（card.json）は vault 側です。
> 見た目は公開されるので、**オリジナル（または権利処理済み）の素材だけを `portal-app/assets/avatars/` に置く**こと。
> アクセスキー未設定の訪問者にはキャラクター・会話UIは表示されません。

- **日記の月次まとめ運用**: 月が終わったら日別ファイルを暦年ディレクトリ配下の
  `YYYY/YYYY-MM.md`（`# YYYY年M月` + `## YYYY年M月D日` 見出し・`---` 区切り）へ統合する。
  AI チャットに「2026年6月の日記をまとめて」と頼めば `rollup_diary_month` ツールが実行される
  （日別ファイルの削除は明示的に依頼したときのみ）。

- 公開URLは **`https://app.knowledgenote.work/`** です。GitHub Pages（`…/my-portal/portal-app/`）も並行稼働していますが、オリジンが別なので設定（アクセスキー等）は共有されません。

## セットアップ

1. 中間サーバー（`worker-proxy/`）をデプロイし、Secret `GITHUB_PAT`（`my-portal-vault` への `Contents: write`）と `PORTAL_API_KEY` を登録します（手順は `worker-proxy/README.md`）。GitHub PAT はブラウザには置きません。
2. ポータル（`https://app.knowledgenote.work/`）を開き、設定画面の「アクセスキー」に `PORTAL_API_KEY` と同じ値を入力して保存します。
3. 必要に応じて Gemini API キーを設定すると AI チャット機能が利用できます。
4. キャラクターの見た目は設定画面で切り替えられます（人格は vault の `persona/card.json` で1つ）。

## 機能

- 📄 **日報** — 当日の日記ファイル（`vault/diary/YYYY-MM-DD.md`）を表示・編集。「再生成」でテンプレートを生成（ブラウザ内で作成）
- 📝 **メモ** — `vault/task/memo.md` を主題ごとのカード（`## 見出し` 単位）で管理。「MD」ボタンで全文編集にも切替可
- 📌 **タスク** — `vault/task/tasks.json` をAIチャットのツール（get_tasks / add_task / update_task）経由で管理
- 🤖 **AI チャット** — Gemini（Function Calling 対応）を使ったコーチング・秘書機能。人格は vault の `vault/persona/card.json`（1つ）で定義
- 🎭 **アバターの表情・背景** — 立ち絵の表情差分と背景を独立レイヤーで管理。定義は見た目ごとの `scene.json`。
  AI は返答に `[表情:happy]` タグを入れて表情を切り替える。表情画像は `assets/avatars/<slug>/expressions/` に置く
  （未配置でも avatar.png + CSS の疑似表情で動作。生成画像の背景透過・軽量化は `tools/remove-generated-background.js`）
- 🔄 **見た目の切り替え** — 見た目は `assets/avatars/<slug>/` に置き `index.json` に1行足すと設定画面から選べる。
  既定は card.json の `defaultAvatar`。人格は vault につき1つで、切り替えはしない
- 🧊 **3D アバター・音声（任意）** — Perxona Connect Kit。設定画面で Publishable Key・アバター・音声を選ぶと有効化
- 💬 **会話ログ** — アバターとの会話を1往復ごとに要約せず `vault/conversations/YYYY-MM-DD_アバター会話.md` へ自動追記
- 🗂 **過去の記録** — `vault/diary` / `vault/knowledge` を一覧・閲覧・編集。
  一覧上部の入力欄から **表示中のディレクトリへ新規ファイルを追加**できる
  （`.md` は省略可、`YYYY-MM-DD` / `YYYY-MM` は日記の見出し規約で雛形を生成、同名があれば上書きせず開く）
- 📔 **振り返り** — 日報をもとに AI が振り返りコメントを生成

## ネットワークエラーについて

各機能で「ネットワークエラー」と表示される場合、以下の原因が考えられます。

| 原因 | 対処方法 |
|------|----------|
| GitHub PAT が未設定または無効 | ⚙️ 設定から PAT を再登録してください |
| PAT がデータリポジトリを対象にしていない | fine-grained PAT の場合、対象リポジトリに `my-portal-vault` が含まれているか確認してください |
| リポジトリ名が間違っている | `portal-app/data/portal-config.json` の `repo` を確認してください |
| PAT のスコープ不足 | `Contents: write` と `Actions: write`（classic なら `repo` + `workflow`）を付与してください |
| オフライン状態 | ネットワーク接続を確認してください |
| Gemini API キーが無効 | ⚙️ 設定で API キーを確認してください |

## PWA 対応

このポータルは PWA（Progressive Web App）として動作します。ブラウザの「ホーム画面に追加」からアプリとしてインストールできます。

## レイアウトFW試験導入（Tailwind PoC）

- Tailwind は **CDN版を最小導入** しています（ビルド工程なし）。

- 現在の適用範囲は **`.layout` / `header` / `card` / `main-tabs` / `report-tabs` のレイアウト・外枠** です。
	- モバイル: 1カラム
	- タブレット: 2カラム
	- デスクトップ: `380px 1fr 285px`
- 既存の `css/*.css` はそのまま併用し、段階的移行できる構成です。
