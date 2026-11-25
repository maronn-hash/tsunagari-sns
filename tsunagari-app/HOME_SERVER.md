# 自分のPCから社外へ公開する

## 登録済みのSNSを固定URLへ切り替える

更新版の `start-sns.cmd` はngrokの固定URLを使います。初回だけ `setup-fixed-url.cmd` で設定します。導入・更新・起動手順は [FIXED_URL.md](FIXED_URL.md) を参照してください。

独自ドメインは不要です。運用担当者だけngrokの無料アカウントを用意します。SNSを利用するメンバーは従来のID・パスワードでログインします。ChatGPTへのログインは不要です。

これまでの `data-external-trial` を残したままファイルを上書きしてください。アカウント・投稿・画像・カレンダーはそこに保存されています。起動場所を変えたり、データを削除したりしないでください。更新前の停止中にデータフォルダー全体をバックアップしてください。

## 管理者をまだ登録していない場合

1. Node.js 24以上をインストールする。
2. アプリフォルダーでPowerShellを開き、以下を実行する。

```powershell
node build.mjs
$env:DATA_DIRECTORY = 'data-external-trial'
Remove-Item Env:PUBLIC_ORIGIN -ErrorAction SilentlyContinue
Remove-Item Env:RENDER_EXTERNAL_URL -ErrorAction SilentlyContinue
$env:NODE_ENV = 'development'
$setupSecret = Read-Host '自分だけが知っている初期設定コードを32文字以上で入力' -AsSecureString
$env:ADMIN_SETUP_TOKEN = [System.Net.NetworkCredential]::new('', $setupSecret).Password
node server.mjs
```

3. 同じPCの `http://127.0.0.1:5173` を開き、設定したコードで最初の管理者を登録する。この段階は自分のPC内だけの接続。
4. 登録できたら `Ctrl+C` で停止し、次を実行して初期設定コードを環境から消す。

```powershell
Remove-Item Env:ADMIN_SETUP_TOKEN -ErrorAction SilentlyContinue
Remove-Variable setupSecret -ErrorAction SilentlyContinue
```

5. [FIXED_URL.md](FIXED_URL.md)に従ってngrokを導入・設定し、`start-sns.cmd` を開く。
6. 管理者のプロフィール →「メンバー管理」でログインIDに対応する招待コードを発行し、固定URLと一緒に案内する。

## 従来のCloudflare一時URLで試す場合

`start-external.ps1` は以前と同じ試用専用です。Node.js 24以上とcloudflaredが必要です。初回登録の場合は32文字以上の初期設定コードを入力します。登録済みなら入力は空欄で構いません。

```powershell
./start-external.ps1
```

表示される `Trial URL` は再起動ごとに変わります。固定URLの設定後、普段は `start-sns.cmd` を使ってください。同時に両方を起動しないでください。

## 運用

- PC・回線・起動画面を動かしている間だけ接続できます。スリープ中は利用できません。
- 停止は `Ctrl+C`。起動したSNSとトンネルを終了します。
- 自動起動サービス、ルーター、ファイアウォール、スリープの設定は変更しません。
- デスクトップから開きたい場合は `start-sns.cmd` 本体を移動せず、ショートカットを作ります。
- 固定URLの初回設定後、iPhoneでWi-Fiを切って携帯回線からログイン・投稿・画像・カレンダーを確認してください。

参考: [ngrok](https://ngrok.com/docs/gateway/domains) / [Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
