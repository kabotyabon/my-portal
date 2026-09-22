# 決定ログ

時系列の1行ログ。詳細は各ページの「変遷」欄と、my-portal-vault の git 履歴（旧 vault/docs/adr/、2026-08-15 に廃止）を参照。

| 日付 | 決定 | 反映先 |
|---|---|---|
| 2026-04-07 | GitHub Contents API をプライマリストレージに | storage |
| 2026-04-07 | PAT＋リポジトリ設定で接続先を決定 | storage |
| 2026-04-07 | Cloudflare D1 移行を音声機能追加まで延期 | storage |
| 2026-04-07 | フレームワーク段階移行を計画（現在は保留） | README |
| 2026-04-07 | プロファイル切替UIをやめ初期設定で固定 (却下) | README |
| 2026-04-11 | 日記とAIフィードバックを単一フローに統合 | diary-tasks |
| 2026-04-11 | アプリカタログモデルを導入→後に廃止 (却下) | README |
| 2026-04-11 | タスクを単一ドメインに統合→後に廃止 (却下) | README |
| 2026-04-11 | 外部連携の統一Provider→後に廃止 (却下) | README |
| 2026-04-12 | 外部タスク取得をAPI Route経由に→廃止 (却下) | README |
| 2026-04-12 | Cloudflare Workers(OpenNext)配備→廃止 (却下) | demo-deploy |
| 2026-04-12 | 各アプリから日記への反映 | diary-tasks |
| 2026-04-14 | 日記セクションの差分登録（upsert） | diary-tasks |
| 2026-04-14 | 仕事用Backlogアプリを計画→後に廃止 (却下) | README |
| 2026-04-16 | チェックリストのVault同期仕様 | diary-tasks |
| 2026-04-16 | AIチャットはブラウザからGemini直接呼び出し | conversation |
| 2026-04-16 | 家計管理のSQLite移行→機能ごと廃止 (却下) | README |
| 2026-04-21 | 日記ドラフトをlocalStorageに自動保存 | diary-tasks |
| 2026-04-21 | 日記のMarkdown対応 | diary-tasks |
| 2026-04-22 | AIモチベーションメッセージを常時表示 | conversation |
| 2026-04-23 | 日記反映のセクション重複防止 | diary-tasks |
| 2026-04-23 | 家計データのGitHub回帰→機能ごと廃止 (却下) | README |
| 2026-04-23 | チェックリストのリンク対応 | diary-tasks |
| 2026-04-26 | 課題アプリのプロジェクト表示→廃止 (却下) | README |
| 2026-05-01 | ブラッシング記録をチェックリストへ統合 | diary-tasks |
| 2026-05-01 | AIチャット会話のリモート保存 | conversation |
| 2026-05-01 | 日記キャッシュの手動更新ボタン | diary-tasks |
| 2026-05頃 | GitHub-as-a-Backend構想→採らず (却下) | README |
| 2026-05頃 | ADR駆動のリポジトリ管理方針を採用 | README |
| 2026-05頃 | タスクをtasks.jsonで管理 | diary-tasks |
| 2026-07-10 | ディレクトリ構造をwork-vaultと統一 | storage |
| 2026-07-10 | docsをvault配下へ・日記の月次まとめ | storage |
| 2026-07-26 | AIリマインド・振り返り・日記改良 | conversation |
| 2026-07-27 | AIプロンプトへ現在日時を注入 | conversation |
| 2026-07-27 | 表情差分・背景分離と会話逐次記録 | persona |
| 2026-07-31 | UI刷新「Ambient Companion」 | persona |
| 2026-07-31 | 対話をユーザー起点に統一 | conversation |
| 2026-07-31 | 返信候補の選択を評価シグナルに | conversation |
| 2026-08-03 | 過去の記録パネルから日記・ナレッジ新規作成 | diary-tasks |
| 2026-08-03 | アバターを差し替え可能なディレクトリに | persona |
| 2026-08-03 | 会話ログからプロンプト改善（第1回） | conversation |
| 2026-08-03 | 表情差分シートを連結成分で分割 | persona |
| 2026-08-03 | 同時書き込みの消失を楽観的ロックで防止 | storage |
| 2026-08-04 | FBループを内部で閉じる | conversation |
| 2026-08-04 | 評価の保存先をvault 1本に | storage |
| 2026-08-05 | 追記専用ツールと上書きガード | storage |
| 2026-08-06 | 公開と非公開をリポジトリ境界で分離 | demo-deploy |
| 2026-08-06 | ペルソナを一般化して公開側へ | persona |
| 2026-08-07 | 人格の定義と記憶を分離 | persona |
| 2026-08-08 | Cloudflareへの移行を決定（保留） | demo-deploy |
| 2026-08-08 | ペルソナ作成機能を構想（保留） | persona |
| 2026-08-08 | パスフレーズ暗号化廃止・「覚えて」ボタン | persona |
| 2026-08-15 | 「日記に書く」を発話ショートカット化 | conversation |
| 2026-08-15 | ADR運用を廃止しハンドブック方式へ | README |
| 2026-08-15 | 設計ドキュメントを vault からアプリ側 docs/architecture/ へ移設 | README |
| 2026-08-18 | 思考トークン切れによる空返答を修正し、失敗も会話ログへ残す | conversation |
| 2026-08-18 | モデルを gemini-3.7-flash へ更新・モデル名を GEMINI_MODEL に一元化 | conversation |
| 2026-08-19 | コスト優先で gemini-3.5-flash-lite を既定に（月額試算¥190・予算上限月¥1,000） | conversation |
| 2026-08-19 | AI書き込みの日記画面への即時反映（no-storeキャッシュ＋書き込みイベント） | diary-tasks |
| 2026-08-19 | デイリーチェックリスト「今日の四つ」を機能ごと削除（スマホは4タブに） | diary-tasks |
| 2026-08-19 | 設定画面のアバター表情プレビュー・背景設定UIを削除（タグ切替は継続） | persona |
| 2026-08-19 | メモ画面のボタンを暗色ガラス化（白ガラスが背景と同化して読めない問題） | conversation |
| 2026-08-28 | card.json に「すり合わせの型」節を追加（2回目のズレで目的合わせに切り替える。全文は vault/knowledge/すり合わせの型.md） | persona |
| 2026-08-28 | 「ナレッジを含める」チェック時に knowledge のファイル一覧をコンテキスト注入（従来は空振り。本文は read_file で取得） | conversation |
| 2026-09-13 | AIアバター強化に Perxona Connect Kit を採用する方針で計画書を起草（docs/plans/perxona-integration.md）。作業は Codespaces / 別PC で行い、メインPCに外部キットを入れない | persona / plans |
| 2026-09-22 | Perxona Connect Kit の3D・音声統合が完了。設定画面のグローバルトグルとして実装（パック仕様v2の renderer 切替は不採用） | persona |
| 2026-09-22 | 完了した計画書 docs/plans/perxona-integration.md を削除し persona.md へ統合。試作用リポジトリ my-portal-Perxona のローカルクローンを削除（GitHub 上のリポジトリ自体は残置） | README / persona |

以後、決定のたびにこの表へ1行追記する（新しい行を末尾に）。
