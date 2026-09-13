# Perxona Connect Kit 導入計画（AIアバター強化）

> **status: planning** — 2026-09-13 起草。着手前の計画書。進捗は末尾の「進捗ログ」に追記する。
> 作業は **GitHub Codespaces または別PC** で行う（メインPCに外部キット・追加ランタイムを入れない方針）。

## 1. 目的

my-portal の AI アバター（こはる）を、2D 立ち絵＋CSS 疑似表情から、
**3D アバター＋音声（TTS）＋自動リップシンク＋文意連動モーション**へ強化する。
描画と音声の基盤に [Perxona Connect Kit](https://connect.perxona.ai/)（XRSPACE、Apache-2.0）を採用する。

守るもの:

- **人格と記憶の分離**（`docs/architecture/persona.md`）。card.json は変更しない。記憶は vault のまま
- **静的サイト・サーバーなし**（GitHub Pages）。Perxona は Publishable キーだけでブラウザから利用できるため、Cloudflare Worker 移行を前提にしない
- **2D へ戻れること**。Perxona 経路はペルソナパックの `renderer` 切替で有効化し、既存の 2D 描画はフォールバックとして残す

## 2. 前提事実（2026-09-13 時点の調査）

| 項目 | 内容 |
|---|---|
| SDK | CDN 配信の `<sv-presenter>` Web コンポーネント。既定 URL `https://cdn.perxona.ai/prod/latest/widget/entry/presenter.js` |
| 初期化 | `presenter.initializeWithConnectKey(publishableKey, { avatarId, sceneId, voiceId })`。`PRESENTER_STATUS` イベントが `Ready` になったら利用可 |
| 発話 | `present(text)` で TTS＋リップシンク＋モーション自動選択。`presentWithAudio(audio, text)` で自前音声。`interruptPresentation()` で中断 |
| モーション指定 | 文中に `[MOTION <motion-id>:1]`。Motion Browser（`tools/motion-browser`）で一覧確認 |
| アバター | カタログ（リアル系・アニメ系・VRM）または自前 VRM 1.0（100MB 以下・Humanoid 必須ボーン15本・表情は VRM 1.0 expression presets（口形5＋感情5）か ARKit-52・MToon 推奨・Spring Bone 未対応）。**データは Perxona 側クラウド**に組織アカウント単位で保管され、ブラウザは Connect API から取得する。自前 VRM のアップロードは**現状スタッフ依頼（Discord）のみ**（OpenAPI には `POST /assets/vrm/upload` の定義があるがドキュメント上は未開放）。**プレビュー中にアップロードした VRM は約1か月で失効**（正式版以降は保守予定） |
| 音声 | **TTS は Perxona 側が内蔵**（Azure / Google、OpenAPI 上は aws / elevenlabs も定義）。`present(text)` だけで音声合成→リップシンクまで完結し、自前実装は不要。`GET /voices` で `languages` に `ja` を含むボイスを選び `voiceId` に渡す。自前音声を使いたい場合のみ `presentWithAudio(ArrayBuffer, text)`（フォーマットの明記なし） |
| キー | **Publishable キー**: ブラウザ可（カタログ取得・presentation 生成・音声トークン）。ドメイン制限を必ず設定。**Secret キー**: サーバー専用（チャットボット・ナレッジ管理）。本計画では **Secret キーを使わない** |
| LLM | 自前 LLM 可。my-portal は既存の Gemini 呼び出しをそのまま使い、返答テキストを `present()` へ渡す。内蔵チャットボット（従量課金）は使わない |
| 料金 | 2026-09-20 までプレビュー（課金なし）。以後 Free プラン既定。`present()`（TTS・モーション生成）が従量対象。カタログ取得は対象外。枯渇時は HTTP 400 `code: 1003` / `14005` |
| 登録 | https://console.perxona.ai （Google Sign-In）。サインアップ API は無く手動 |
| サンプル | `samples/express`（Embed / Studio デモ、Node 22）。**参考実装として読むだけ**で、my-portal には組み込まない |

## 3. 作業環境（メインPCに入れない）

### 3-1. GitHub Codespaces（推奨）

- `my-portal` リポジトリで「Code → Codespaces → Create」。`.devcontainer/devcontainer.json`（本計画と同時に追加）が Node 22 環境を用意する
- my-portal 自体はビルド不要。`npm start`（`npx serve .`）で起動し、転送ポートをブラウザで開く
- Perxona サンプルを動かして挙動を確認したい場合も Codespaces 内で `git clone https://github.com/XRSPACE-Inc/perxona-connect-kit` する。メインPCには落とさない
- **秘密情報**: Publishable キーは既存の Gemini キーと同じく**ブラウザの localStorage**（設定画面）に置く。Codespaces Secrets や `.env` には書かない（サーバーが無いので不要）。Secret キーは発行しても Console から出さない
- Codespaces は無料枠（個人 120 コア時間/月）内で収まる想定。使い終わったら Stop する

### 3-2. 別PC

- Node 22 と git だけ入れる。手順は 3-1 と同じ（`git clone` → `npm install` → `npm start`）
- Console へのログインと Publishable キーのドメイン制限設定はどの端末からでもよい

### 3-3. メインPCでやること・やらないこと

- **やる**: 計画書・設計ドキュメントの更新、コードレビュー、Pages 公開後の実機確認（ブラウザのみ）
- **やらない**: `perxona-connect-kit` の clone、Node パッケージの追加インストール、VRM 制作ツールの導入

## 4. フェーズ

### Phase 0 — 体験（プレビュー期間中・2026-09-20 まで）

目的: 「Gemini の返答を Perxona で喋らせる」が成立するかを最小コストで確かめる。

1. Console 登録、Publishable キー発行、ドメイン制限に Pages の公開ドメインと Codespaces の転送ドメインを登録（本人作業）
2. `?perxona` 実験モードを追加（URL パラメータ。デモモード `?demo` と同じ流儀）
3. 対話画面のアバター領域に `<sv-presenter>` を差し込み、カタログの既製アバター1体・日本語ボイス1つを固定で使う
4. Gemini 返答の**表情タグを取り除いたテキスト**を `present()` に渡す（タグは既存パイプラインで先に消費する）
5. 実機（PC ブラウザ・スマホ Safari）で、声質・リップシンク・遅延・自動モーションの違和感を確認

完了条件: こはるの人格で 3D アバターが日本語で喋る動画が撮れる。
判断ポイント: **9/20 以降の料金表**を見て、Phase 1 以降へ進むか判断する。

### Phase 1 — ペルソナパック仕様 v2（renderer 切替）

1. `scene.json` に以下を追加（`docs/persona-pack-spec.md` §3 を更新）
   ```jsonc
   "renderer": "perxona",            // "2d"（既定）| "perxona"
   "perxona": {
     "avatarId": "...", "sceneId": "...", "voiceId": "...",
     "motions": { "happy": "smile_wave", "sad": "look_down" }   // 表情id → motion-id
   }
   ```
2. `avatar-scene.js` の描画を **2D / Perxona の2実装に分け**、`setExpression()` の呼び口は変えない
   - 2D: 現行どおり
   - Perxona: `setExpression(id)` は `motions[id]` を記録し、次の `present()` 時に `[MOTION id:1]` を文頭に付与する
3. 設定画面に Publishable キー欄を追加（`settings.js` の既存キー保管と同じ `_writeKey` 経路）
4. `?perxona` 実験モードを廃止し、パックの `renderer` で切り替える
5. `card.json` は変更しない。`promptGuide()`（表情タグの案内文）は renderer に依らず同じ

完了条件: `renderer` を `"2d"` に戻すだけで従来表示に復帰する。

### Phase 2 — こはるの VRM 化（任意）

1. VRoid Studio 等で こはるを制作（`assets/persona/image-prompts.md` を元絵の仕様として使う）。**制作は別PC**
2. VRM 1.0 でエクスポート、表情プリセット（happy/sad/surprised 等）を設定
3. Console にアップロード、`avatarId` を scene.json に反映
4. 既存の 8表情 PNG は 2D フォールバック用に残す

判断ポイント: Phase 0 でカタログの既製アバターに満足なら実施しない。

### Phase 3 — アプリ化

1. PWA の仕上げ（オフライン時の案内、インストール導線）。`manifest.json` は既存
2. Perxona 経路がサーバー不要なため静的のまま維持。ネイティブ配布（Capacitor / Tauri）が要るかは Phase 2 後に判断
3. Cloudflare 移行（`demo-deploy.md` の保留事項）はこの計画の**前提にしない**。移行するなら Publishable キーのドメイン制限を更新するだけ

## 5. 実装メモ（着手時に読む）

- 差し込み点: `portal-app/js/ui/ai-chat.js` の `AvatarScene.setExpression(page.expression)`（ページ描画時）。ここで Perxona 時はページ本文を `present()` にも渡す。ページ送り（VN 方式）と音声の同期は「ページ表示 → present → 再生終了後に次ページ可」を初期案とし、Phase 0 で違和感を見る
- `present()` はユーザー操作後でないと音が出ない（自動再生ポリシー）。送信ボタン押下時に `resumeAudioPlayback()` を1回呼ぶ
- スクリプト読み込みは `type="module"` の script タグを1回だけ注入（Embed デモの `loadPresenterEngine()` と同じ）。キャッシュバストの `?v=` 運用対象外（CDN 側管理）
- 「考えています…」中は `setExpression('thinking')` が呼ばれる（ai-chat.js）。Perxona では present しない（モーションだけ記録）
- デモモード `?demo` と Perxona の併用は Phase 0 では非対応。デモは 2D 固定
- 失敗時（`CONNECT_KEY_REJECTED`、code 1003/14005、スクリプト読込失敗）は 2D にフォールバックし、システム行として会話ログに残す（conversation.md の失敗記録方針に合わせる）

## 6. リスク

| リスク | 対応 |
|---|---|
| プレビュー終了後の料金が個人利用に合わない | Phase 0 の判断ポイントで打ち切り。`renderer: "2d"` で撤退できる |
| 日本語 TTS の声質・遅延が人格に合わない | Phase 0 で確認。`presentWithAudio` で別 TTS を差す余地はある（ただしブラウザ内で完結する TTS が必要） |
| こはるの見た目の連続性が失われる | Phase 2 の VRM 化で回収。着手しない選択もあり |
| ベンダーロックイン | パック仕様は `renderer` 切替で吸収。Perxona 固有値は `perxona` ブロックに閉じる |
| Publishable キーの流出 | ドメイン制限を必須化。流出時は Console でローテーション |
| Codespaces の localStorage は Pages と別オリジン | 実験時はキーを毎回入れ直す前提。Pages 反映後は Pages 側に保存 |

## 7. 未決事項（本人判断）

- [ ] Phase 0 をプレビュー期間中（9/20 まで）に実施するか
- [ ] アバターは「カタログの既製」から入るか「VRM 自作」から入るか
- [ ] 作業環境は Codespaces か別PCか（両方可。本計画はどちらでも同じ手順）

## 8. 進捗ログ

- **2026-09-13** — 計画書起草。Perxona Connect Kit の仕様調査（キー種別・料金・SDK メソッド・VRM 要件）を §2 に記録。`.devcontainer/devcontainer.json` を追加し Codespaces で着手できる状態にした
- **2026-09-13** — 追加調査: VRM アップロードは現状スタッフ依頼のみ・プレビュー中は約1か月で失効、TTS は内蔵で自前実装不要、を §2 に反映。Phase 2（VRM 化）は正式版（9/20 以降）のアップロード手段と保守方針を見てから着手する
