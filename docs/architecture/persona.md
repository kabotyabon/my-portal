# ペルソナと記憶

## いまの仕様

### 三層モデル — 人格・表示・音声（2026-09-25〜）

キャラクターを3つの層に分け、それぞれ独立に選べるようにする。**置き場所は「個人に属するか」で決める。**

| 層 | 中身 | 置き場所 | 取得経路 |
|---|---|---|---|
| **人格** | `card.json`（口調・規律・プロンプト）＋ 記憶（`persona-state/`） | vault（非公開） | 中間サーバー経由（アクセスキー必須） |
| **表示** | 2D: 立ち絵・表情差分・`scene.json` ／ 3D: Perxona アバター | アプリ（公開） | 相対 fetch ／ Perxona Connect API |
| **音声** | Perxona Voice（将来 Gemini TTS） | アプリ（公開）＋キー | 各キーは個人の秘匿値として localStorage |

- **人格は vault につき1つ。** 選ぶものではなく、その vault の持ち主の相棒（将来の多人数利用では各自の vault に1つずつ入る）。
  見た目と声は誰でも使える共通カタログから選ぶ
- `card.json` の `defaultAvatar` が既定の見た目を指す。設定画面で上書きできる（どの見た目とも組み合わせられる）
- **ユーザーの記憶**は `vault/persona-state/`。キャラクターではなくユーザーに紐づくので、人格を差し替えても残る
- Perxona・Gemini のキーはどちらも秘匿扱い（ブラウザの localStorage のみ、リポジトリ・vault には置かない）

### 配置

```
my-portal-vault/vault/persona/      ← 人格（非公開・1つだけ）
  card.json                         ← こはる（defaultAvatar: kohaho）

my-portal/portal-app/assets/avatars/ ← 表示（公開）
  index.json                        ← 一覧 [{slug, name}]
  <slug>/scene.json / avatar.png / expressions/ / image-prompts.md
```

- 見た目の選択は localStorage の `active_avatar_slug`（未設定なら人格の `defaultAvatar`）。解決は `js/core/config.js` の `getAvatarDir()` に集約
- 設定画面「キャラクター」の見た目一覧で選び、`location.reload()` で読み直す（下記「設定画面」）
- 人格を替えたいときは `vault/persona/card.json` 自体を書き換える。見た目を足すときは `assets/avatars/<slug>/` を置いて `index.json` に1行
- 見た目は公開面に出るので、オリジナル作品（または権利処理済み）の素材だけを置く
- 形式の詳細は `my-portal/docs/persona-pack-spec.md`（§2 card.json / §3 scene.json / §4 画像要件 / §5 タグプロトコル）:
  - `card.json` は `intro` ＋ `sections` 配列（見出し＋行）でシステムプロンプトを組み立てる。
    `{呼称}` / `{userCallName}` を `userCallName` で置換。`postHistory` は予約（未使用）
  - 表情は標準8種: neutral / happy / excited / gentle / thinking / worried / sad / surprised。
    画像が無い表情は `avatar.png` ＋ CSS 疑似表情で代用（画像ゼロの見た目も有効）
  - 見た目ディレクトリ内のパス参照はすべて相対

### アクセスキー未設定時は人格・会話UIを一切出さない

- `js/core/app.js`: `getToken()` が無ければ card.json（vault）も scene.json も読まない。人格は vault にあるので、そもそも取得できない
- `js/ui/avatar-scene.js` の `mount()`: `.vn-stage` に `is-locked` を付けて即 return（立ち絵・3D 初期化をしない）
- `css/ai-chat.css`: `.vn-stage.is-locked` 配下の会話UI一式を隠し、「設定からアクセスキーを入力してください」（`#vn-locked-msg`）だけを出す
- アクセスキーを保存すると `location.reload()` で全体が再初期化される

### 3D アバター・音声（Perxona Connect Kit）

2D 立ち絵＋CSS 疑似表情に加え、[Perxona Connect Kit](https://connect.perxona.ai/)（XRSPACE、Apache-2.0）による
3D アバター描画＋TTS＋自動リップシンクを選択式で使える。パック仕様（`scene.json` の `renderer` 切替）ではなく、
設定画面の見た目一覧に「〇〇（3D）」として並ぶ（下記「設定画面」）。

- 該当ファイル: `js/core/perxona-config.js`（Key・Avatar/Scene/Voice ID を localStorage に保持）・
  `js/presenter/perxona-stage.js`（`<sv-presenter>` の初期化・発話・中断）・
  `js/ui/perxona-settings.js`（設定画面）・`css/perxona.css`・`avatars.html`（アバター一覧・ID 確認用）
- Avatar・Voice は Connect API のカタログ（`/assets/avatars`・`/voices?language=ja`）を取得してプルダウンで選ぶ
  （Avatar は以前 ID 手入力だった）。Scene ID は静的（`PerxonaConfig.DEFAULTS.sceneId`。背景は舞台側の scene.json が担う）
- 有効化条件は `PerxonaConfig.isEnabled()`: Publishable Key が設定済みかつ見た目で 3D を選んでいる
- `avatar-scene.js` が `mountPerxona()` / `unmountPerxona()` で 2D と 3D の表示を切り替える。
  初期化失敗（`CONNECT_KEY_REJECTED` / SDK 読み込み失敗など）は `onFail` 経由で 2D 立ち絵へ自動フォールバックする
- Key は Publishable Key のみを使う（Secret Key は使わない）。ブラウザにしか置けないため、
  ドメイン制限を Console 側で必ず設定する運用を前提にする
- Region は `asia` 固定（Console の Key 発行元と SDK の CDN/API を一致させる必要があるため）
- 表情タグ（`[表情:]`）に連動したモーション指定はこの版では未実装。発話中は `present(text)` の自動選択に任せる

### 設定画面

- **キー欄は3つとも同じ形**（アクセスキー・Gemini・Perxona）: 未設定なら入力欄＋保存、設定済みなら「設定済みです」。
  下に操作行（接続テスト・削除・結果表示）。共通クラスは `.key-set-msg` / `.key-actions` / `.key-test-status`（base.css）
- **キャラクター欄**: 見た目を1つの一覧で選ぶ。2D は `assets/avatars/index.json` から「こはる（2D）」、
  Perxona キーがあるときだけ Connect API カタログから「〇〇（3D）」が加わる。値は `2d:<slug>` / `3d:<avatar_id>`
- 音声の選択と音声テストは 3D を選んでいるときだけ出る（Perxona の声は 3D 表示とセットでしか鳴らないため）
- 「切り替える」で保存して `location.reload()`。2D を選ぶと 3D はオフ、3D を選ぶとオン（2D の見た目は失敗時のフォールバックとして残る）

### persona-state — 記憶の実体

`js/domains/persona-state.js` が管理。置き場は `vault/persona-state/`（private 側）。

- **`profile.md`** — ユーザー像。毎回システムプロンプトに丸ごと載る。4セクション固定・各上限つき:

  | セクション | 上限 |
  |---|---|
  | 呼び方と距離感 | 3 |
  | いま気にかけていること | 3 |
  | 触れてほしくないこと | 5 |
  | 応答の好み | 5 |

  上限超過はアプリが機械的に**最古から**落とす（AI に任せない — プロンプトに書いた規律は
  守られないことを3回実測済み）。落ちた行は書き込み結果に報告される
- **`learned.md`** — 観察の蓄積（プロンプトに載せない・昇格前の材料）。パスは定義済みだが書く経路は未実装
- 読み込み失敗（PAT 未設定・オフライン）でも例外を投げず、対話は続けられる

### 「覚えて」の二重導線

書き込みは明示的に頼まれたときだけ。自動更新にしない（何が書かれるかを人が見ないまま
人格が変質するのを避ける）。導線は2つで、片方に賭けない:

1. **`remember_about_user(fact, section)` ツール** — AI が発話から拾えたとき。section は4セクションの enum 固定
2. **「🧠 覚えて」ボタン**（`js/ui/remember-panel.js`）— モデルを経由せず `PersonaState.remember()` を直接呼ぶ。
   直前のユーザー発話を初期値に入れ、PAT 未設定なら保存前に止める

どちらも **profile.md（効かせる先）と当日の日記（根拠。`## 🧠 覚えたこと` に時刻つき・上限なし）の
両方**に書く。片方だけだと、あとで振る舞いが変わった理由を追えない。
日記側の失敗は profile 側の成功を妨げない（記録が主、根拠が従）。

## 変遷

- **2026-09-25** 設定画面を整理。キー欄（Gemini・Perxona）の接続テスト行を揃え、「2D/3D スイッチ＋別々の見た目指定」を
  「こはる（2D）」「〇〇（3D）」が並ぶ1つの一覧に統合（3D は Perxona キーがあるときだけ出る）。Scene ID 入力欄は削除
- **2026-09-25** 人格と表示を分離。`card.json` を公開側から `vault/persona/card.json` へ移し中間サーバー経由で読む。
  人格は vault につき1つとし、設定画面での人格選択は廃止（こまるの人格定義は外した。見た目は残る）。
  公開側は見た目専用の `assets/avatars/<slug>/` に改名し、`card.json` の `defaultAvatar` と設定画面の上書きで組み合わせる。
  画像は人格と切り離された共通素材なので公開のままでよい、という整理。同時にデモモード（`?demo`・`demo.json`）を
  機能過大として削除。こまるの背景も `auto` に揃えた
- **2026-09-25** 複数ペルソナを設定画面から選べるようにした。`assets/persona/`（使用中）＋`assets/_名前/`（控え）を
  `git mv` で入れ替える方式をやめ、全パックを `assets/personas/<slug>/` に並べて `index.json` で一覧化。
  こまるをデモ専用から通常選択肢にも昇格。人格・表示・音声を独立に選ぶ3層モデルへの第一歩
- **2026-09-25** アクセスキー未設定時は人格・会話UIを一切表示しないよう変更（app.knowledgenote.work公開に伴う）。
  あわせてPerxonaのAvatar IDをConnect APIカタログ（`/assets/avatars`）取得のプルダウンに変更（Voiceと同じ方式）
- **2026-09-25** `scene.json`の`defaultBackground`を`mood`（表情ごとの暗い紫〜黒グラデーションに追従）から
  `auto`（時刻連動。日中は明るい水色系）に変更。舞台が常に暗く見える、という指摘を受けて。
  `mood`自体・各表情の`bg`定義は変更していないため、`[背景:mood]`タグで従来の見た目にいつでも戻せる
- **2026-09-22** Perxona Connect Kit による3Dアバター・音声を統合。設定画面のグローバルトグルとして実装し、
  当初計画（`scene.json` に `renderer` / `perxona` ブロックを追加するパック仕様v2）は採らなかった:
  グローバル1系統で足り、パックごとの3Dアセット管理は現時点で需要がない。
  これまで別リポジトリ `my-portal-Perxona` で試作していたが、本体（この my-portal）への修正が追随しない
  問題があったため統合し、以後はここを唯一の開発元にした。試作リポジトリのローカルクローンは削除した。
  計画書 `docs/plans/perxona-integration.md` は役目を終えたため削除し、内容はこのページへ統合した
- **2026-08-19** 設定画面の「アバターの表情と舞台」セクション（背景セレクタ・表情プレビュー）を削除。
  表情・背景の切り替え自体は対話中の `[表情:]` / `[背景:]` タグで引き続き動く。
  UI からしか使われていなかった背景の永続化（vault/config.json の avatarBackground・
  localStorage の avatar_background）も撤去し、起動時はペルソナの defaultBackground から始まる
- **2026-08-12** 画像の生成用プロンプトを各パック内 `image-prompts.md` として復元。card.json への
  取り込みは「card.json の全フィールド＝ランタイム契約」を守るため不採用
- **2026-08-08** 「覚えといて」がモデルに一度も拾われていなかったため、「🧠 覚えて」ボタンを追加し
  UI から確実に発火させる二重化に。ツールをやめてボタンだけにするは採らなかった: AI が拾えるなら
  そのほうが自然で、両方あって困らない
- **2026-08-08** ペルソナ作成機能（画像生成含む）は長期課題として保留。成長するのは記憶であって
  画像ではないため急がない。着手条件は下記残課題欄
- **2026-08-07** 人格の定義（card.json）とユーザーの記憶（persona-state/）を分離。`persona.md` の
  自前 frontmatter パーサを廃止（CRLF とコロンで壊れる穴が JSON 化で構造的に消える）。
  Character Card V2 の PNG 埋め込みは採らなかった: 配布用の設計で、共有しないなら画像と定義が
  結合する欠点しか残らない。記憶の自動更新も採らなかった: 人が見ないまま人格が変質する
- **2026-08-06** ペルソナを一般化（作品固有の組織名・職能・名前の3要素を変更、人格の芯は維持）し、
  正本を公開リポジトリ `portal-app/assets/persona/` に一本化。vault 側の複製は削除。
  vault 側にも残す案は採らなかった: 二重管理でどちらが正か分からなくなる
- **2026-08-06** リポジトリ分割時、ペルソナは Pages 相対 fetch の都合で公開側に配置。当時使用中の
  人格は著作物依拠の疑いで vault に退避し控えを公開した（→ 精査の結果 08-06 中に上記 051 で復帰）
- **2026-08-03** 表情差分シートの分割ツールを新設。格子の決め打ちではなく連結成分で割り、
  背景トーンは画像の外周から読み取る。共通キャンバス 896x1200 へ下端合わせで正規化
  （揃えないと表情切替のたびに立ち絵が跳ねる）
- **2026-08-03** ペルソナを「差し替え可能な1ディレクトリ」に集約。読み込みは `PERSONA_DIR` 1箇所、
  控えは `_` 接頭辞、切替はリネーム2回。挨拶などの人格に属する文字列をコードから人格側へ移動。
  設定UI・GitHub API 探索・index.json は採らなかった: 稀な操作に対して部品が多すぎる

## 既知の問題・残課題

- **こはるの VRM 化は未着手**。カタログの既製アバターで運用中。自前 VRM を使う場合、アップロードは現状
  Perxona 側のスタッフ依頼（Discord）のみで、プレビュー版はアップロード後 約1か月で失効する制約がある
- **表情タグとPerxonaのモーション指定の連動は未実装**。`present(text)` の自動選択任せで、
  `[MOTION <motion-id>:1]` によるモーション指定は使っていない
- **Publishable Key はブラウザ localStorage に平文保存**（storage.md の認証情報保存方式と同じ扱い）。
  ドメイン制限を Console 側で設定する運用でしか守れていない
- **ペルソナ作成機能（画像生成）は保留中**。着手条件: (1) Cloudflare 移行の完了（生成 API キーを
  ブラウザに置けないため Worker が前提）(2) 実際に作り直したい具体的な動機があること。
  着手時はスコープ固定（既存の手作業パイプラインを画面に載せるだけ）、段階分割
  （①画像加工のブラウザ移植 → ②マスター1枚生成 → ③8表情一括）、1日あたりの生成上限を先に入れる
- **`learned.md` を書く経路が無い**。`remember` は profile へ直接書く。観察をどう溜めるかは
  profile が実際に埋まってから決める
- **`postHistory` は空のまま**。どの規律を後置に移すかは、効果を測れる状態になってから
- **上限到達で古い行が落ちたときの妥当性を人が確認する手段が無い**（日記に残るので追えるが通知は無い）
- **persona-state/ はアプリの archive 画面から閲覧・編集できない**（`archive.js` が diary / knowledge
  しか一覧しない）。手で GitHub を開くのが現状の運用
- **ランタイム注入文が日本語のみ**。card.json の `language` は予約済みだが `"ja"` のみ有効（spec v2 スコープ）
