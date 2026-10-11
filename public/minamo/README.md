# minamo

`npm run dev`で起動し、`/minamo/`を開く。
すべての接続は同じDurable Objectに接続する。

物理パラメータは`physics.js`の`PARAMETERS`で調整する。
流速は中心から右端まで約2時間（約0.069単位/秒）。投入位置と波紋によって滞在時間は変わる。
波紋の力は100、水の抵抗係数は0.8とし、波紋到達時の移動を見やすくする。
仮想空間は1000×1000、カメラは中心固定、画面の短辺を1000単位に合わせる。
水面外の余白は投入できない。画面外でも仮想空間内の落ち葉は保持する。

小石の5秒制限はWebSocket接続単位。再接続時にリセットする。
落ち葉の1時間制限はCookieで管理し、同じ接続内ではサーバーでも検証する。
Cookieを変更・削除した上で再接続すると制限を回避できる。

共有状態と存続中の波紋をDurable Object Storageに保存する。
接続と操作時に経過時間を計算し、常時演算や定期送信は行わない。
静かな期間は水の抵抗を解析的に計算し、波紋の存続中だけ短い刻みで計算する。
画面は同じ計算で予測し、新しい状態への位置補正を400msで補間する。

Wranglerの`minamo-v1` migrationでSQLite Durable Objectを追加する。
D1のスキーマ変更やデータ投入は不要。

確認: `npm run typecheck`、`npm run test:api`。
ローカルWorker起動中の結合テスト（PowerShell）:
`$env:MINAMO_URL = 'http://127.0.0.1:8787'; node --test tests/minamo/websocket.test.mjs`

WebSocketの休止と接続メタデータはCloudflareのHibernation APIを使用する。
https://developers.cloudflare.com/durable-objects/best-practices/websockets/
