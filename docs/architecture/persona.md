# ペルソナと記憶

## いまの仕様

### 二層構造 — 人格の定義と、ユーザーの記憶

- **人格の定義**はペルソナパック（アプリ側・静的）。人間が書き、対話では変化しない
- **ユーザーの記憶**は `vault/persona-state/`（データ側）。AI／ユーザーが書き、使うほど変わる
- 記憶はキャラクターではなく**ユーザーに紐づく**。ペルソナを差し替えても記憶は残る

### ペルソナパック

人格・表情・舞台演出を1ディレクトリに封じたポータブルな配布単位。仕様の正は
`my-portal/docs/persona-pack-spec.md`（§1 構成 / §2 card.json / §3 scene.json / §3.5 demo.json /
§4 画像要件 / §5 タグプロトコル / §7 配布ルール）。要点のみ:

- 構成: `card.json`（人格定義・必須）/ `scene.json`（表情・背景・演出・必須）/ `avatar.png`（必須）/
  `image-prompts.md`（画像の生成用プロンプト。アプリは読まない）/ `demo.json`（デモ台本・任意）/ `expressions/`
- `card.json` は `intro` ＋ `sections` 配列（見出し＋行）でシステムプロンプトを組み立てる。
  `{呼称}` / `{userCallName}` を `userCallName` で置換。`postHistory` は予約（未使用）
- 表情は標準8種: neutral / happy / excited / gentle / thinking / worried / sad / surprised。
  画像が無い表情は `avatar.png` ＋ CSS 疑似表情で代用（画像ゼロのパックも有効）
- パック内のパス参照はすべてパック相対。絶対パスを書かないことがポータビリティの根拠

### 複数ペルソナの配置と切り替え

```
portal-app/assets/personas/
  index.json          ← 一覧（[{slug, name}]）。静的サイトはディレクトリ一覧を取れないため手で管理
  kohaho/             ← こはる（既定）
  komaru/             ← こまる（デモモードの固定の顔でもある）
```

- 選択中の slug は localStorage（`active_persona_slug`）。未設定なら `kohaho`
- 読み込みパスは `js/core/config.js` の `PERSONA_DIR`（起動時に1回だけ決まる）に集約。
  設定画面「ペルソナ」で切り替えると `location.reload()` で読み直す
- デモモード（`?demo`）は選択に関わらず常に `komaru`。オーナーが今どのペルソナを使っているかを
  公開デモで漏らさないため
- パックを追加するときは `personas/<slug>/` を置いて `index.json` に1行足すだけ
- ペルソナが公開リポジトリ側にあるのは、相対 fetch で読む必要があるため。
  公開面に置く以上、オリジナル作品（または権利処理済み）のパックだけを置く
- 人格（このパック）・表示（2D立ち絵 / Perxona 3D）・音声（Perxona Voice、将来は Gemini TTS も）の
  3層を独立に選べるようにするのが目標。現状、表示と音声は Perxona 設定側でグローバルに持つ

### アクセスキー未設定時は人格・会話UIを一切出さない（2026-09-25）

ポータル本体が独自ドメイン（`app.knowledgenote.work`）で公開URLになったことに伴い、**未認証の訪問者に
人格（card.json/scene.json）を見せない**よう変更した。デモモード（`?demo`）はこの制限を受けない。

- `js/core/app.js`: card.json/scene.json の読み込み自体を `window.DEMO_MODE || !!getToken()` の条件下でのみ行う
- `js/ui/avatar-scene.js` の `mount()`: 条件を満たさなければ `.vn-stage` に `is-locked` クラスを付けて即 return（立ち絵・3D 初期化を一切行わない）
- `css/ai-chat.css`: `.vn-stage.is-locked` 配下で背景・立ち絵・3D層・会話ログ・台詞・返信候補・添付・入力欄など
  会話UI一式を `display: none` にし、代わりに「設定からアクセスキーを入力してください」の案内文（`#vn-locked-msg`）だけを出す
- アクセスキーを保存すると `location.reload()` で全体が再初期化されるため、追加のイベント配線は不要

### 3D アバター・音声（Perxona Connect Kit）

2D 立ち絵＋CSS 疑似表情に加え、[Perxona Connect Kit](https://connect.perxona.ai/)（XRSPACE、Apache-2.0）による
3D アバター描画＋TTS＋自動リップシンクを選択式で使える。パック仕様（`scene.json` の `renderer` 切替）ではなく、
**設定画面のグローバルトグル**として実装した。

- 該当ファイル: `js/core/perxona-config.js`（Key・Avatar/Scene/Voice ID を localStorage に保持）・
  `js/presenter/perxona-stage.js`（`<sv-presenter>` の初期化・発話・中断）・
  `js/ui/perxona-settings.js`（設定画面）・`css/perxona.css`・`avatars.html`（アバター一覧・ID 確認用）
- Avatar・Voice は Connect API のカタログ（`/assets/avatars`・`/voices?language=ja`）を取得してプルダウンで選ぶ
  （2026-09-25〜。Avatar は以前 ID 手入力だった）。Scene ID はカタログ取得APIが未確認のためテキスト入力のまま
- 有効化条件は `PerxonaConfig.isEnabled()`: Publishable Key が設定済みかつ設定画面のスイッチが ON
  （Key があれば既定 ON）。デモモード（`?demo`）は常に 2D 固定
- `avatar-scene.js` が `mountPerxona()` / `unmountPerxona()` で 2D と 3D の表示を切り替える。
  初期化失敗（`CONNECT_KEY_REJECTED` / SDK 読み込み失敗など）は `onFail` 経由で 2D 立ち絵へ自動フォールバックする
- Key は Publishable Key のみを使う（Secret Key は使わない）。ブラウザにしか置けないため、
  ドメイン制限を Console 側で必ず設定する運用を前提にする
- Region は `asia` 固定（Console の Key 発行元と SDK の CDN/API を一致させる必要があるため）
- 表情タグ（`[表情:]`）に連動したモーション指定はこの版では未実装。発話中は `present(text)` の自動選択に任せる

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
- **画像は公開リポジトリ側のまま**。vault へ戻すには Worker プロキシが要る
- **ランタイム注入文が日本語のみ**。card.json の `language` は予約済みだが `"ja"` のみ有効（spec v2 スコープ）
