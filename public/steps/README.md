# steps

`/steps/` で武えのきの歩数を月ごとに表示します。閲覧は認証不要です。
未記録日は「—」と表示し、0歩の記録と区別します。

## ローカル起動

```sh
npm ci
npm run db:migrate:local
npx wrangler d1 execute junk-services --local --file=seeds/local/steps.sql
npm run dev
```

表示確認用データは2026年10月の架空データです。
マイグレーションは `migrations/0005_create_steps.sql` です。
`local_date` を主キーとし、利用者IDは保存しません。
本番へのマイグレーション・DML・デプロイは別途実施してください。

## 認証設定

`.dev.vars.example` を `.dev.vars` にコピーし、次の値を設定します。

- `STEPS_GOOGLE_CLIENT_ID`: 更新アプリが取得するGoogle IDトークンの対象クライアントID（aud）。
- `STEPS_GOOGLE_SUB`: 更新を許可するGoogleアカウントのsub。

本番ではそれぞれ `npx wrangler secret put STEPS_GOOGLE_CLIENT_ID` と
`npx wrangler secret put STEPS_GOOGLE_SUB` でランタイムシークレットに設定します。
値やIDトークンをリポジトリやログに記録しないでください。
クライアントシークレットはIDトークン検証には使用しません。

PUTは `Authorization: Bearer <Google ID token>` を必要とします。
Google公開鍵でRS256署名を検証し、iss・aud・exp・iat・subを確認します。
公開鍵はGoogleのCache-Controlに従ってキャッシュします。
認証設定不足や公開鍵取得失敗は503、無効なトークンは401、許可外subは403です。
GETはこれらの設定に依存せず、Authorizationも使用しません。

## API

- `GET /api/v1/daily-steps?from=2026-10-01&to=2026-10-31`
- `GET /api/v1/daily-steps/2026-10-01`
- `PUT /api/v1/daily-steps/2026-10-01`

PUT本文は `{"steps":8432,"timezone":"Asia/Tokyo","recordedAt":"2026-10-01T23:58:12+09:00"}`。
一覧は両端を含む最大366日、日付昇順、欠損日は補完しません。
日時はミリ秒精度のUTCに正規化します。
新規201、新しい記録への更新と同一再送200、古い記録や同時刻で内容が異なる記録409です。
同一再送ではupdatedAtを変えません。保存判定はD1のトランザクション内で行います。
成功・エラーともno-store、エラーはapplication/problem+jsonです。

今回の合意により、参照仕様の利用者同期 `PUT /users/me` と利用者の登録・停止管理は対象外です。
未登録・利用停止に由来するエラーも返しません。同期APIは404です。
同期専用の初回登録レート制限も対象外です。歩数APIのレート制限値は要件に未指定です。
閲覧ページにログイン・更新機能はありません。更新は外部アプリから行います。

## 検証

400などの失敗時は、レスポンスJSONの `code`・`traceId` を確認してください。
400では `errors` 配列に `field`・`code`・`message` を返します。
たとえば `body.recordedAt` の `INVALID_TIMESTAMP` なら日時の形式を確認します。
現在の実装では小数秒は最大3桁で、タイムゾーンが必須です。

同じ `traceId` のJSONログを4xxはwarn、5xxはerrorで出力します。
ローカルでは `npm run dev` を起動したターミナルに表示されます。
ログには入力値・追加項目名・認証トークン・Google sub・内部例外は出力しません。
アプリ側でも400の応答本文を読み取ると、アクセスログだけでは分からない原因を確認できます。

```sh
npm run typecheck
npm run test:api
```
