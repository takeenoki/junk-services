# 歩数API・サービス

## 1. 概要・目的
- 武えのきの歩数を保存・共有するAPIとそれを閲覧するWebサービスを作成する

## 2. サービス名
- steps

## 3. 構成
- 月ごとの歩数を表示するWebページ。歩数取得はデータベースから行う。
- 歩数の管理を行うAPI
- 歩数を保持するD1データベース

## 4. D1
- D1データベースのjunk-servicesにテーブルを作成する
- 歩数管理テーブル名はstepsとする
- stepsテーブルの項目は以下とする
- 特定の個人に特化したサービスなので、ユーザーIDの保存は行わない。

| カラム名    | 型 |
| ---         | --- |
| local_date  | TEXT NOT NULL |
| steps       | INTEGER NOT NULL CHECK (steps BETWEEN 0 AND 1000000) |
| timezone    | TEXT NOT NULL |
| recorded_at | TEXT NOT NULL |
| updated_at  | TEXT NOT NULL |

## 5. API仕様
- ./reference/steps-api-specification.md を参照のこと

## 6. 認証
- 更新系APIのみGoogle IDPによる認証を行う。
- Google認証クライアントの情報はローカルでは.dev.varsに保存し、本番環境ではシークレットのランタイム変数で保持する。