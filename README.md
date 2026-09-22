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
│   ├── data/portal-config.json  ← 参照先リポジトリ・ブランチ
│   └── assets/persona/          ← AI ペルソナ一式（仕様は docs/persona-pack-spec.md）
├── docs/architecture/         ← 設計ドキュメント（テーマ別ハンドブック）。入口は README.md、決定の時系列は decisions.md
├── tools/                     ← 画像下処理スクリプト（アプリからは呼ばない）
└── index.html                 ← 旧URL → portal-app/ へのリダイレクト

my-portal-vault/               ← データリポジトリ（private・Contents API 経由で参照）
└── vault/
    ├── diary/                 ← 日記（当月: YYYY-MM-DD.md / 過去月: YYYY/YYYY-MM.md）
    ├── conversations/         ← アバターとの会話ログ（自動追記）
    ├── knowledge/             ← ナレッジ
    ├── task/                  ← タスク・メモ（tasks.json / memo.md）
    └── config.json            ← アプリ設定（クイックリンク等）
```

> **ペルソナだけは公開リポジトリ側にあります。** 静的サイトはディレクトリ一覧を取得できないため
> Pages からの相対 fetch で読んでおり、private リポジトリには置けないためです。
> したがって **公開しても差し支えないペルソナだけを `portal-app/assets/persona/` に置く**こと。

- **日記の月次まとめ運用**: 月が終わったら日別ファイルを暦年ディレクトリ配下の
  `YYYY/YYYY-MM.md`（`# YYYY年M月` + `## YYYY年M月D日` 見出し・`---` 区切り）へ統合する。
  AI チャットに「2026年6月の日記をまとめて」と頼めば `rollup_diary_month` ツールが実行される
  （日別ファイルの削除は明示的に依頼したときのみ）。

- 公開URLは `…/my-portal/portal-app/` です（旧 `…/my-portal/` からは自動転送）。ホーム画面に追加済みの場合は開き直すと転送されます。

## デモ（セットアップ不要）

公開URLに `?demo` を付けて開くと、**PAT・APIキーなし**でアバターとの対話を体験できます
（表情・背景の切り替え、返信候補ボタンでの会話送り）。

- デモの案内役は専用ペルソナ「こまる」（`portal-app/assets/_komaru/`）。使用中のペルソナとは独立です
- デモの会話は台本（パック内の `demo.json`）で、**データはどこにも保存されません**
- 台本はペルソナパックの一部です。仕様は `docs/persona-pack-spec.md` §3.5 を参照

## セットアップ

1. **GitHub Personal Access Token（PAT）** を取得します。**データリポジトリ（`my-portal-vault`）に対する** `Contents: write` と、日報生成に使う `Actions: write` が必要です（classic なら `repo` + `workflow`）。
2. 参照先リポジトリ・ブランチは `portal-app/data/portal-config.json` の `repo` / `branch` で設定します（既定は `toshikazu-takemasa/my-portal-vault`）。
3. ポータルを開き、右上の ⚙️ 設定ボタンから PAT を入力して保存します。
4. 必要に応じて Gemini API キーを設定すると AI チャット機能が利用できます。

## 機能

- 📄 **日報** — 当日の日記ファイル（`vault/diary/YYYY-MM-DD.md`）を表示・編集。「↻ 日記を再生成」で GitHub Actions（daily-report.yml）からテンプレート付きで生成
- 📝 **メモ** — `vault/task/memo.md` を主題ごとのカード（`## 見出し` 単位）で管理。「MD」ボタンで全文編集にも切替可
- 📌 **タスク** — `vault/task/tasks.json` をAIチャットのツール（get_tasks / add_task / update_task）経由で管理
- 🔗 **クイックリンク** — よく使うサービスへのショートカット（並び替え・追加対応、`vault/config.json` に保存）
- 🤖 **AI チャット** — Gemini（Function Calling 対応）を使ったコーチング・秘書機能。ペルソナは `portal-app/assets/persona/card.json` で定義
- 🎭 **アバターの表情・背景** — 立ち絵の表情差分と背景を独立レイヤーで管理。定義は `portal-app/assets/persona/scene.json`。
  AI は返答に `[表情:happy]` タグを入れて表情を切り替える。表情画像は `portal-app/assets/persona/expressions/` に置く
  （未配置でも avatar.png + CSS の疑似表情で動作。生成画像の背景透過・軽量化は `tools/remove-generated-background.js`）
- 🔄 **アバターの切り替え** — 人格一式（card.json / scene.json / 画像）を1ディレクトリにまとめ、
  **使用中は `portal-app/assets/persona/`、控えは `_名前/`** で置く。切り替えはディレクトリのリネーム2回だけ
  （`git mv assets/persona assets/_old && git mv assets/_new assets/persona`）。
  読み先は `js/core/config.js` の `PERSONA_DIR` に集約している
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
