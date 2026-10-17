# Jevの画像判定を試す

`/jev-image-playground/` で画像と質問を入力し、noul・choice・scoreを試せます。
画像はブラウザー内でPNG化・縮小し、判定ボタンで送信します。

## ローカル起動

ルートの `.dev.vars` に以下を追記してください（Git管理対象外）。
既存ファイルがなければ `.dev.vars.example` をコピーして作成できます。

```dotenv
JEV_IMAGE_PLAYGROUND_API_KEY="your-vercel-ai-gateway-key"
```

```sh
npm run db:migrate:local
npm run dev
```

`http://localhost:8787/jev-image-playground/` を開きます。
キーはVercel AI Gatewayのキーを使用します。ブラウザーには渡しません。

## 設定とAPI

- `wrangler.jsonc` の `JEV_IMAGE_PLAYGROUND_MODEL` でモデルを変更できます。初期値は `jev-1.14.0`。
- 本番のキーは `npx wrangler secret put JEV_IMAGE_PLAYGROUND_API_KEY` で設定します。
- `GET /api/jev-image-playground` は接続先・モデル・日本時間の日付・残回数を返します。
- `POST /api/jev-image-playground` は `{ type, question, criteria?, image }` を受け取ります。
  `image` はPNGのbase64（data URLの接頭辞なし）、`criteria` は文字列配列です。
  choiceでは各行を選択肢名と説明に使い、scoreでは配列順に0から評価します。
- 接続先は `https://ai-gateway.vercel.sh/typesafe/v1/systemone`。
  画像用ヘッダー `TypeSafe-Danger-Zone-Images: true` を付けて送信します。
- `jev-image-playground-access-cnt` に日付ごとの回数を保存します。他サービスとは共有しません。
  日本時間0時で日付を切り替え、全利用者で200回まで。D1の単一SQLで枠を確保します。
  Jevへの接続失敗・タイムアウト・エラーレスポンスも消費し、再送はしません。
  入力エラー・認証キー未設定・上限到達はJevに送信せず、消費しません。
- 画像自体や質問・レスポンスはDBに保存しません。

## 確認

```sh
npm run typecheck
node --experimental-strip-types --test tests/jev-image-playground/api.test.mjs
```

APIテストは外部送信をモックします。実際のGatewayで1.14の画像入力が利用可能かは、
有効なキーによる疎通で確認してください。本番マイグレーション・公開は別途実施します。
