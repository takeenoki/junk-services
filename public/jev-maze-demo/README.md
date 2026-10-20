# Jevに迷路を解かせるデモ

`npm run dev` で起動し、`http://localhost:8787/jev-maze-demo/` を開きます。
サイズ選択で9×9・16×16・25×25を選び、初期化ボタンでランダムな迷路を生成します。
サイズ変更は次の初期化時に反映します。スタートは左上、ゴールは右下で、必ず到達できる迷路を生成します。
初期化後、迷路のマスをクリックすると壁と通路が反転します。Jevの判定中は編集できません。
「迷路を進む」ボタンを押すたびに編集後のCanvasのPNGをJevへ送り、1マスの移動を試みます。
指示と選択肢はサーバーで固定しています。質問はchoice形式の `questions.decision` のみです。
生成中の迷路はブラウザー内のみで保持し、DBには保存しません。

認証キーは既存の `JEV_IMAGE_PLAYGROUND_API_KEY` を共用します。
ローカルではGit管理外の `.dev.vars` に設定してください。
本番では同名のWorkersシークレットを利用します。キーはブラウザーへ返しません。

`POST /api/jev-maze-demo` は `{ image }`（720×720pxのPNGのbase64）を受け取り、
`https://ai-gateway.vercel.sh/typesafe/v1/systemone` の `jev-1.14.0` にchoice形式で送信します。
`GET /api/jev-maze-demo` は日本時間の日付、上限、残回数を返します。
`jev_maze_access_cnt` で全利用者共有の日次2000回の上限を管理し、日本時間0時に切り替えます。
送信前にDBで1回分を確保し、接続失敗・不正なJev応答もカウントします。入力エラーやキー未設定はカウントしません。
残回数は接続情報の下に表示します。上限到達時はJevに送信せず429を返します。
新規テーブルは `migrations/0007_create_jev_maze_access_cnt.sql` で作成します。
ローカルでは `npm run db:migrate:local` を実行してください。本番への適用は別途必要です。
応答には選択結果と、画像データを省略したJevへのリクエスト・レスポンスを含めます。
通信失敗時の自動再送は行いません。

確認: `npm run typecheck` と `node --experimental-strip-types --test tests/jev-maze-demo/*.test.mjs`。
APIテストは外部接続をモックします。
