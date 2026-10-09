-- ローカル動作確認用の架空データ
DELETE FROM magazine_titles;
INSERT INTO magazine_titles (title, title_url, author, author_url, start_issue, end_issue)
VALUES ('サンプル作品', NULL, 'サンプル作者', NULL, '2000年1号', '連載中');
