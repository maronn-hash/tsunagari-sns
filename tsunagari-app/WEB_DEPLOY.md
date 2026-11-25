# Web公開の準備

PC・iPhoneのブラウザからURLで開くための、Render用の設定を追加しました。**まだサービスは作成しておらず、公開URLもありません。** 元の公開先へのソース転送は接続エラーで失敗しました。

## 準備した構成

- Node.js 24.22.1のWebサーバー1台（0.5 CPU・512MB）
- 投稿・画像・アカウントを保存する永続ディスク1GB
- Renderが発行するHTTPS URLを自動で使用
- 初期設定コードをRenderがランダム生成
- 専用ID・パスワードによるログイン。登録は社員向けの招待制

`render.yaml` は有料構成です。適用前に現在の見積額を確認してください。無料Webサービスには永続ディスクを付けられないため、この構成を単純に無料プランへ変更すると、データが再起動時に消える原因になります。

## 公開までの残り作業

1. Renderの追加・アカウント接続。
2. 公開用リポジトリを決定し、`tsunagari-app` 内のファイルを配置。秘密・実データは含めない。
3. サービスとディスクの料金を確認し、作成を承認。
4. Blueprintで `render.yaml` を適用してデプロイ。
5. 管理画面で `ADMIN_SETUP_TOKEN` の値を確認し、発行されたHTTPS URLから最初の管理者を登録する。
6. 未ログイン時の拒否、画像投稿、ログアウト、iPhone表示を確認する。

独自ドメインを使う場合は `PUBLIC_ORIGIN` にそのHTTPSオリジンを設定します。未設定なら `RENDER_EXTERNAL_URL` を使います。本番でどちらもなければ起動を拒否します。

## 参考

- https://render.com/docs/blueprint-spec
- https://render.com/docs/disks
- https://render.com/docs/environment-variables
- https://render.com/pricing

公開するのはログイン画面であり、投稿・画像の閲覧には社内SNSのログインが必要です。ChatGPTアカウントは利用しません。
