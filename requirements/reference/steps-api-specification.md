# API 連携仕様

契約の正本は OpenAPI とし、ここでは既存契約を変更しません。実環境のホスト名と稼働状況は別途確認してください。例のホスト、ID、日時は説明用の架空値です。

## 共通仕様

- ベース URL: `https://{host}/api/v1`。環境ごとのホスト名に置き換えます。
- JSON の項目名は camelCase。成功応答は `application/json`、エラーは `application/problem+json` です。
- PUT は Google Sign-In で取得した **ID トークン**を `Authorization: Bearer {id-token}` で送ります。許可された運用者のみ更新できます。
- 歩数 GET は認証不要です。Authorization を付けても取得対象は変わらず、サーバー設定で指定された運用者の公開歩数を返します。成功・エラーとも `Cache-Control: no-store` です。
- 利用者 ID、メールアドレス、Google `sub` をパス・クエリ・本文で指定しません。
- 日付はローカル日付の `YYYY-MM-DD`。日時はタイムゾーン付き ISO 8601 形式で、保存時に UTC に正規化します。

| 操作 | メソッド | パス（ベース URL に追加） | 認証 | 成功 |
| --- | --- | --- | --- | --- |
| 利用者同期 | PUT | `/users/me` | 必須 | 新規 201、登録済み 200 |
| 日次歩数登録・更新 | PUT | `/daily-steps/{date}` | 必須 | 新規 201、更新・同一再送 200 |
| 日次歩数取得 | GET | `/daily-steps/{date}` | 不要 | 200 |
| 日次歩数一覧取得 | GET | `/daily-steps?from={from}&to={to}` | 不要 | 200 |

ヘルスチェック `GET /` は認証不要ですが、OpenAPI に応答スキーマが定義されていないため、この文書では連携契約の対象外とします。

## 1. 利用者同期

初回ログイン後、歩数 PUT より先に呼び出します。同じ Google 認証主体の再送・同時要求は同じ内部利用者に収束します。

```http
PUT /api/v1/users/me HTTP/1.1
Host: api.example.com
Authorization: Bearer {id-token}
Accept: application/json
```

要求本文、パスパラメーター、クエリパラメーターはありません。

成功時は `201 Created` または `200 OK`、`Location: /api/v1/users/me` を返します。

```json
{
  "id": "example-user-id",
  "status": "active",
  "createdAt": "2026-08-23T04:12:34Z"
}
```

| 項目（すべて必須） | 型 | 意味 |
| --- | --- | --- |
| `id` | string | 不透明な内部利用者 ID。1〜128文字 |
| `status` | string | 成功時は `active` |
| `createdAt` | string | 利用者を作成した UTC 日時 |

Google `sub`、メールアドレス、表示名、画像 URL は返しません。初回同期の制限は IP ごとに1分10回です。

## 2. 日次歩数登録・更新

```http
PUT /api/v1/daily-steps/2026-08-16 HTTP/1.1
Host: api.example.com
Authorization: Bearer {id-token}
Content-Type: application/json
Accept: application/json

{
  "steps": 8432,
  "timezone": "Asia/Tokyo",
  "recordedAt": "2026-08-16T23:58:12+09:00"
}
```

| 入力 | 型 | 必須 | 制約 |
| --- | --- | --- | --- |
| パス `date` | string | 必須 | 実在するローカル日付、`YYYY-MM-DD` |
| 本文 `steps` | integer | 必須 | 0〜1,000,000 |
| 本文 `timezone` | string | 必須 | canonical IANA 名、1〜255文字。例: `Asia/Tokyo`。UTC オフセットだけの値は不可 |
| 本文 `recordedAt` | string | 必須 | クライアントが日次値を確定したタイムゾーン付き日時 |

本文の追加項目は許可しません。`date` は本文ではなくパスに指定します。取得元 `source` は送信しません。

成功時は `201 Created` または `200 OK`、`Location: /api/v1/daily-steps/2026-08-16` を返します。本文は次節の日次歩数オブジェクトです。

| 保存済みデータとの比較 | 結果 |
| --- | --- |
| データなし | 作成して 201 |
| `recordedAt` が新しい | 置き換えて 200 |
| `recordedAt` と内容が同じ | 変更せず 200 |
| `recordedAt` が古い | 変更せず 409 |
| `recordedAt` が同じで内容が異なる | 変更せず 409 |

比較対象は `steps`、`timezone`、`recordedAt` です。同じ利用者・ローカル日付で一意に保存し、再送でレコードを増やしません。

## 3. 日次歩数取得と共通の歩数応答

```http
GET /api/v1/daily-steps/2026-08-16 HTTP/1.1
Host: api.example.com
Accept: application/json
```

パス `date` は必須のローカル日付です。要求本文はありません。成功時は `200 OK` と次の JSON を返します。歩数 PUT の成功本文も同じ形式です。

```json
{
  "date": "2026-08-16",
  "steps": 8432,
  "timezone": "Asia/Tokyo",
  "recordedAt": "2026-08-16T14:58:12Z",
  "updatedAt": "2026-08-16T15:01:03Z"
}
```

| 項目（すべて必須） | 型 | 意味・制約 |
| --- | --- | --- |
| `date` | string | 集計対象のローカル日付 |
| `steps` | integer | 0〜1,000,000 |
| `timezone` | string | 集計時の canonical IANA 名、1〜255文字 |
| `recordedAt` | string | クライアントが値を確定した日時。例は UTC 正規化後の値 |
| `updatedAt` | string | API が最後に保存した UTC 日時 |

歩数応答に内部利用者 ID、Google `sub`、メールアドレス、JWT claim は含めません。対象日の歩数がない場合は `404 DAILY_STEPS_NOT_FOUND` です。

## 4. 日次歩数一覧取得

```http
GET /api/v1/daily-steps?from=2026-08-16&to=2026-08-17 HTTP/1.1
Host: api.example.com
Accept: application/json
```

| クエリ | 型 | 必須 | 制約 |
| --- | --- | --- | --- |
| `from` | string | 必須 | 開始ローカル日付、`YYYY-MM-DD` |
| `to` | string | 必須 | 終了ローカル日付、`YYYY-MM-DD`。`from` 以降 |

両端を含む最大366日を取得します。ページネーションはありません。要求本文はありません。成功時は `200 OK` と次の JSON を返します。

```json
{
  "items": [
    {
      "date": "2026-08-16",
      "steps": 8432,
      "timezone": "Asia/Tokyo",
      "recordedAt": "2026-08-16T14:58:12Z",
      "updatedAt": "2026-08-16T15:01:03Z"
    }
  ]
}
```

`items` は必須の配列で最大366件、日付の昇順です。各要素は前節の日次歩数オブジェクトです。active な運用者の期間内データがない場合は `{"items": []}` を返し、欠損日を歩数0のオブジェクトで補完しません。

旧取得元パスは404、旧 `source` クエリは `400 VALIDATION_ERROR` です。

## 共通エラー

```json
{
  "type": "https://api.example.com/problems/daily-steps-version-conflict",
  "title": "日次歩数の更新が競合しました",
  "status": 409,
  "code": "DAILY_STEPS_VERSION_CONFLICT",
  "detail": "保存済みの値を取得し、再集計してから更新してください。",
  "instance": "/api/v1/daily-steps/2026-08-16",
  "traceId": "example-trace-id"
}
```

| 項目 | 型 | 必須 | 意味 |
| --- | --- | --- | --- |
| `type` | string（URI） | 必須 | 問題種別 |
| `title` | string | 必須 | 人が読む概要 |
| `status` | integer | 必須 | HTTP ステータス、400〜599 |
| `code` | string | 必須 | 分岐用コード。`^[A-Z][A-Z0-9_]{0,63}$` |
| `traceId` | string | 必須 | 問い合わせ用 ID、1〜128文字 |
| `detail` | string | 任意 | 安全な説明 |
| `instance` | string（URI reference） | 任意 | 要求パス |
| `errors` | array | 任意 | 検証エラーで使用する最大50件の入力エラー |

`errors` の各要素は必須の `field`（例: `body.steps`）、`code` と、任意の `message` を持つオブジェクトです。各値は string です。入力値そのもの、トークン、個人データ、内部例外はエラーへ含めません。

| HTTP | コード・条件 | 対象 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR`: パス・クエリ・本文の不正 | 歩数 PUT / GET |
| 401 | `AUTH_INVALID`: ID トークンなし・無効・期限切れ | PUT |
| 403 | `FORBIDDEN`: 許可外の認証主体 | PUT |
| 403 | `USER_SYNC_REQUIRED`: 利用者未登録 | 歩数 PUT |
| 403 | `USER_UNAVAILABLE`: 利用停止・削除済み | PUT |
| 404 | `NOT_FOUND`: 公開対象の運用者が未登録・停止・削除済み | 歩数 GET |
| 404 | `DAILY_STEPS_NOT_FOUND`: 指定日の歩数なし | 単一歩数 GET |
| 409 | `DAILY_STEPS_VERSION_CONFLICT`: 更新順序・内容の競合 | 歩数 PUT |
| 409 | 再取得で収束できない予期しない整合性競合。コードは OpenAPI に未指定 | 利用者同期 |
| 429 | 要求回数制限。コードは OpenAPI に未指定 | 全4操作 |
| 500 | 内部エラー。コードは OpenAPI に未指定 | 全4操作 |
| 503 | `SERVICE_UNAVAILABLE`: 設定不足・DB等の一時障害 | 全4操作 |

429 / 503 の `Retry-After` は再試行まで待つ秒数です。公開対象を解決できない場合に、他利用者や全件へフォールバックしません。

## クライアントの連携順序と失敗時の処理

1. 更新するアプリは Google Sign-In で ID トークンを取得します。
2. `PUT /users/me` で利用者を同期します。
3. ローカル日付ごとに `PUT /daily-steps/{date}` を送信します。成功応答の保存後に同期済みとします。
4. 閲覧用サイトは認証なしで歩数 GET を呼びます。

| 結果 | 処理 |
| --- | --- |
| タイムアウト・切断・オフライン | 同じ URL と本文を再送対象として保持 |
| 429 / 503 と `Retry-After` | 指定秒数待って再送 |
| 408 / 425 / 429 / 500 / 502 / 503 / 504、待機指定なし | 5秒開始、最大6時間の指数バックオフと jitter で再送 |
| 400 | 自動再送を止め、入力を修正 |
| 401 | トークン更新または再認証を1回試し、解消後に同じ要求を再送 |
| 403 | 自動再送を止め、権限・利用者状態を確認 |
| 歩数 PUT の409 | GET で保存値を取得し、最新の端末データを再集計して新しい `recordedAt` で更新 |
| その他の4xx | 自動再送を止め、契約・状態を確認 |

409で正しい値を判断できない場合は自動上書きを止めます。再送時のステータスには通信経路が返すものも含みます。詳細は [ADR 0002](../adr/0002-daily-steps-put-recovery.md)、認証と公開範囲は [API URL 設計](./README.md) を参照してください。
