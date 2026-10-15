# API仕様ページ作成
## 概要
- 公開APIの仕様ページをswaggerで作成し、公開する。

## 修正内容
- インデックスページをServiceタブとAPIタブに分ける
  - Serviceタブは修正前の仕様とする
  - APIタブは公開するAPIのSwaggerページへのリンクが縦に並ぶ
  - 既存と違和感のないデザインとする
  - 画面オープン時の初期表示はServiceタブとする

## 対象
- 今回作成するSwaggerは以下とする
  - about-me
  - steps
    - 認証が必要なPUTはSwaggerに掲載しない
