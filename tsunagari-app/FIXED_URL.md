# 固定URLで使う（Windows）

独自ドメインを買わずに、ngrokの無料アカウントに割り当てられる固定URLを使います。設定後は `start-sns.cmd` を開くたびに同じURLへ接続します。SNSを使うメンバーにngrok・Cloudflare・ChatGPTのアカウントは不要です。運用担当者だけngrokに登録します。

## 1. 更新ファイルを入れる

1. 今のSNSの起動画面で `Ctrl+C` を押して停止する。
2. 既存の `tsunagari-app` 内の **`data-external-trial` を丸ごとバックアップ**する。
3. 更新版ZIPを展開し、中の `tsunagari-app` のファイルを、これまで使っていた同名フォルダーに上書きする。

`data-external-trial` は削除・移動しないでください。既存のID・パスワード・投稿・画像・予定はこのフォルダーから引き継ぎます。新しく展開した空の別フォルダーから起動すると登録データが見つかりません。設定済みの `.sns-private` も更新時は残してください。

## 2. ngrokを用意する（最初だけ）

1. [ngrokの登録画面](https://dashboard.ngrok.com/signup)で無料アカウントを作る。
2. [Windows用の公式ページ](https://ngrok.com/download/windows)からngrokをインストールする。PowerShellでは公式案内の次のコマンドも使えます。

```powershell
winget install ngrok -s msstore
```

インストール後は新しいPowerShellを開いて `ngrok version` を確認します。Microsoft Storeが使えない場合は、同じ公式ページからWindows用ZIPをダウンロードし、展開した `ngrok.exe` をアプリの `start-sns.cmd` と同じ場所に置く方法にも対応しています。ngrokの実行ファイルはこの配布ZIPには含みません。

## 3. URLと認証トークンを保存する（最初だけ）

1. [Domains](https://dashboard.ngrok.com/domains)に表示された、自分の `https://…ngrok-free.dev` または `https://…ngrok-free.app` を確認する。好きな名前を入力するのではなく、割り当て済みのものを使う。
2. `setup-fixed-url.cmd` をダブルクリックし、そのURLを入力する。
3. [Your Authtoken](https://dashboard.ngrok.com/get-started/your-authtoken)からトークンをコピーして、設定画面に貼り付け、Enterを押す。入力中の文字は表示されない。

AuthtokenはngrokがサーバーPCを認証するための秘密情報で、SNSのログインパスワードとは別です。チャット・GitHub・メンバーへの案内には貼り付けないでください。アプリ内の `.sns-private/fixed-url.json` に平文で保存するため、PC上でこのフォルダーにアクセスできる人を運用担当者に限定してください。配布用ZIP・Git登録の対象外です。

設定の保存だけでは公開されません。次の起動操作が必要です。

## 4. 普段の起動

`start-sns.cmd` をダブルクリックします。登録済みデータとログイン制限を確認してからngrokへ接続し、固定URLからこのSNSへ通信できることを確認してブラウザーを開きます。

- 起動画面の「固定URL」をメンバーに共有します。PCやSNSを再起動しても、同じngrokアカウント・同じドメイン設定ならURLは変わりません。ログイン操作でも変わりません。
- 旧URLからの切り替え時は、新しいURLで一度ログインし直します。ID・パスワードは今までのものを使います。ブックマーク・iPhoneのホーム画面登録も新しいURLに変更してください。
- PCと起動画面を開いたままにします。停止は `Ctrl+C`。PC停止・スリープ中はURLが同じでもアクセスできません。
- 同じURLの起動は1つだけにしてください。接続失敗時は別の一時URLに切り替えず停止します。
- 固定URL用の起動ではcloudflaredは使いません。従来の `start-external.ps1` は一時URLの試用用として残しています。

## 無料プランの制限

2026年11月20日に確認した公式案内では、無料プランは月1GBの転送量・月20,000 HTTPリクエストの上限があります。画像の閲覧や画面更新でも消費します。ブラウザーにngrokの案内ページが出た場合は、URLが自分のものか確認して「Visit Site」で進みます。無料の案内ページはこのアプリでは消しません。

固定URLは常時稼働や無制限利用を意味しません。人数・画像量が増える場合は、利用状況を確認し、別途プランやサーバーを選定してください。

## 接続できないとき

| 表示・状態 | 確認すること |
|---|---|
| 固定URLの設定がありません | `setup-fixed-url.cmd` を開いて保存する |
| ngrokが見つかりません | インストール後に画面を開き直すか、公式の `ngrok.exe` をアプリ内に置く |
| 登録済みアカウントが見つかりません | 以前から使っていた `data-external-trial` があるアプリフォルダーで起動する |
| ngrokが停止しました | DomainsのURL、Authtoken、同じURLを使った別の起動がないかを確認。表示された `ERR_NGROK_…` は公式のエラー案内で確認する |
| 接続確認が時間内に完了しませんでした | URL・トークン・回線・プロキシ設定を確認して再起動する。ネットワーク側でngrokが制限されている場合はその運用担当者に確認する |
| 起動後に見られなくなった | 起動画面が開いているか、PCがスリープしていないか、ngrokの利用上限に達していないかを確認する |

## 確認状況

自動テストで、同じ固定URLでの再起動、既存ログインセッション・投稿・予定の維持、未ログインの拒否、誤ったOriginからの更新拒否、接続失敗時の停止を確認しています。ngrokアカウントを使う実際のインターネット接続とiPhoneでの利用は、上記の設定後に運用者の環境で確認してください。

参考: [固定ドメイン](https://ngrok.com/docs/gateway/domains) / [無料プランの制限](https://ngrok.com/docs/pricing-limits/free-plan-limits) / [CLI導入](https://ngrok.com/docs/gateway/endpoints/agent-cli-quickstart) / [エラー一覧](https://ngrok.com/docs/errors)
