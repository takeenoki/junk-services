# Junk Services

## random-sunday-title

`/random-sunday-title/` のボタンで歴代の週刊少年サンデー連載作品を一つ表示する。
ジャンプ版と同じデザイン・表示項目（作品名、作者、開始号、終了号、Amazon検索リンク）を使用する。
`GET /api/random-sunday-title` は `title`, `title_url`, `author`, `author_url`,
`start_issue`, `end_issue` を JSON で返す。URLがない項目は null。
キャッシュせず、データ未登録は404、DBエラーは500、GET以外は405を返す。

### ローカル起動とデータ生成

```sh
npm ci
npm run db:migrate:local
npx wrangler d1 execute junk-services --local --file=seeds/local/random-sunday-title-data.sql
npm run dev
```

`http://localhost:8787/random-sunday-title/` を開く。ローカル用データは架空の作品。
実作品のSQLは以下の手動実行で生成・適用する。

```sh
python -m pip install -r tools/random-sunday-title/requirements.txt
python tools/random-sunday-title/generate_sql.py
npx wrangler d1 execute junk-services --local --file=seeds/random-sunday-title-data.sql
```

生成先は既存構成に合わせて `seeds/random-sunday-title-data.sql` とし、同名で更新する。
定期実行・自動リトライは行わない。`--html 保存済み.html` で通信なしでも生成できる。
作品一覧テーブルをDOM IDと列見出しで識別し、非表示のソート文字や脚注を除く。
合併号は `1970年2/3号` の形式、連載中作品は `連載中` として保存する。
号数がなく年のみの場合は `1969年` とし、その他の不詳表記は原文を保持する。
空データや解析失敗では既存SQLを更新しない。

SQLは `sunday_titles` のみを削除・再投入するため再適用しても重複しない。
スキーマは `migrations/0003_create_sunday_titles.sql` で追加する。
本番へのDML適用は明示的な指示がある場合のみ行う。

```sh
npm run typecheck
npm run test:api
python -m unittest discover -s tools/random-sunday-title -p "test_*.py"
```

データ出典：Wikipedia contributors「[週刊少年サンデー連載作品の一覧](https://ja.wikipedia.org/wiki/週刊少年サンデー連載作品の一覧)」。
利用・再配布時は出典ページのCC BY-SAライセンス条件を確認する。

## random-jump-title

`/random-jump-title/` のボタンで歴代の週刊少年ジャンプ連載作品を一つ表示する。
`GET /api/random-jump-title` は作品名、作品URL、作者名、作者URL、開始号、終了号を JSON で返す。
抽選結果はキャッシュしない。データ未登録は 404、DB エラーは 500、GET 以外は 405。

### ローカル起動

Node.js 22 以上と Python 3.10 以上を使用する。

```sh
npm ci
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

`http://localhost:8787/random-jump-title/` を開く。
`seeds/local/` のデータは架空の動作確認用。実作品を使う場合は下記の生成 SQL を `--local` で適用する。

### 手動で実データを生成

```sh
python -m pip install -r tools/random-jump-title/requirements.txt
python tools/random-jump-title/generate_sql.py
npx wrangler d1 execute junk-services --local --file=seeds/random-jump-title-data.sql
```

生成先は `seeds/random-jump-title-data.sql`。毎回同名ファイルを更新する。
作品一覧の紙版テーブルのみを取得し、非表示のソート用文字と脚注を除外する。
リンクがなければ URL は NULL。開始・終了は年と号に変換し、連載中の表記は維持する。
合併号の `1970.02/03` や `1975.4･5` はそれぞれ `1970年2/3号`、`1975年4/5号` に変換する。
`連載中（不定期）` はそのまま保存する。
解析エラー時は既存 SQL を更新しない。`--html 保存済み.html` で通信なしでも生成できる。
定期実行は行わず、必要な時だけ手動実行する。

SQL は `jump-titles` の全行を削除してから現在の作品一覧を投入するため、再適用しても重複しない。
他サービスのテーブルには触れない。適用にはファイル単位でトランザクションが管理される D1 の `execute --file` を使う。

### 本番環境の準備

Cloudflare の D1 を作成し、`wrangler.jsonc` の仮の `database_id` を実際の ID に置き換える。
スキーマ変更は `migrations/` のファイルを `wrangler d1 migrations apply junk-services --remote` で適用する。
その後 `npm run deploy` で Worker と静的ファイルを配信する。
本番への DML 適用は別途明示的な指示がある場合のみ行う。

### 検証

```sh
npm run typecheck
npm run test:api
python -m unittest discover -s tools/random-jump-title -p "test_*.py"
```

データ出典：Wikipedia contributors「[週刊少年ジャンプ連載作品の一覧](https://ja.wikipedia.org/wiki/週刊少年ジャンプ連載作品の一覧)」。
利用・再配布時は出典ページの CC BY-SA ライセンス条件を確認する。
