# BEEPERS

`/beepers/` は全ブラウザで共有する10秒ループです。
音一覧・基準時刻・投稿順・Cookie署名鍵は単一のSQLite Durable Objectに保存します。
D1の変更やデータ投入は不要です。
「サンプル」タブでは長押しして試聴し、「音を残す」タブでは長押しして投稿します。
試聴は投稿権を消費せず、共有トラックにも追加されません。

## 開発

```sh
npm run build:beepers
npm run dev:beepers
```

`http://localhost:8787/beepers/` を開きます。
`dev:beepers` はコマンドライン指定でのみ `ENABLE_POST_LIMIT=false` を渡します。
この場合はデバッグモードとして投稿間隔を5秒にし、画面下部に「クリア」を表示します。
クリアは共有トラックの全音を削除して接続中のブラウザに通知します。
基準時刻・投稿順・投稿待ち時間は維持します。
本番設定にはこの値を追加していません。未設定を含め、`false` 以外は1時間制限が有効です。
通常の `npm run dev` では制限が有効になります。

フロントのTypeScriptは `audio.ts` と `script.ts`。既存のTypeScriptコンパイラーで
隣接するJavaScriptに変換し、生成されたファイルも管理します。
変更後は `npm run build:beepers` を実行してください。追加のライブラリは使いません。

## API

- `GET /api/beepers/state`: スナップショット、サーバー時刻、投稿制限状態。
- `GET /api/beepers/ws`: WebSocket。初期状態と各変更の完全スナップショットを通知。
- `POST /api/beepers/start`: `{ type: 1..20, requestId: UUID, pressedAtMs: number }`。
  受理時に投稿権を消費し、音IDと更新トークンを返します。同じCookieとrequestIdの再送は冪等です。
- `POST /api/beepers/finish`: `{ id, token, durationMs }`。開始元Cookieとトークンの両方を検証。
  長さは50〜3000msに収め、一度確定した長さは変更できません。
- `POST /api/beepers/clear`: デバッグ時のみ、共有トラックの全音をクリア。本番では403。

CookieはHttpOnly/SameSite=Strictで、HTTPS時はSecureも付与。
HMAC署名を検証し、投稿制限をサーバーで管理します。
投稿更新トークンは公開スナップショットに含めません。
3秒以内に長さが届かない場合、Alarmで3000msに確定します。
サーバーは押下時刻を直近10秒以内に収め、時刻同期後の押下位置を記録します。
通知には状態のversionを含み、古い状態をクライアントが無視します。

音声は150ms先読み、25ms間隔でAudioContext時刻に予約。
新規音は次のループから予約し、復帰・再接続時は過去の開始位置を再生しません。
音量は投稿順から `0.95^n` で計算し、コンプレッサー・マスターゲイン・
有界のWaveShaperで出力を抑えます。既に鳴っている音量変更は滑らかに適用します。

## 検証

```sh
npm run build:beepers
npm run typecheck
npm run test:api
```

実Workerの統合テストは、別ターミナルでそれぞれ次のサーバーを起動します。

```sh
npm run dev:beepers -- --port 8790
npm run dev -- --port 8791 --persist-to .wrangler/beepers-limited
```

PowerShell:

```powershell
$env:BEEPERS_URL = 'http://localhost:8790'
$env:BEEPERS_LIMITED_URL = 'http://localhost:8791'
node --experimental-strip-types --test tests/beepers/api.test.mjs
```

環境変数がない場合、この統合テストはスキップします。
音声レンダリングの検証ページは次のように一時配置し、ローカルブラウザで
`/beepers/audio-check` を開きます。20音色の最短・最長再生、100音同時再生の
出力ピーク、ループ終端をまたぐ音をOfflineAudioContextで検証します。

```powershell
Copy-Item tests/beepers/audio.html public/beepers/audio-check.html
# 検証後、配信対象から除外
Remove-Item -LiteralPath public/beepers/audio-check.html
```

手動では2つのブラウザで同期と次ループ反映、9秒付近から2秒の長押し、
タブ復帰、通信断、Worker再起動による状態復元を確認してください。
本番配信には `wrangler.jsonc` の `beepers-v1` Durable Object migrationを使用します。
